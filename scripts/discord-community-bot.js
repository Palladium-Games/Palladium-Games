#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const POLL_MS = Number(process.env.DISCORD_COMMUNITY_POLL_MS || 20000);
const RULES_CHECK_MS = Number(process.env.DISCORD_RULES_CHECK_MS || 5 * 60 * 1000);
const STATE_PATH = process.env.DISCORD_COMMUNITY_STATE_PATH || path.join(__dirname, "..", ".discord-community-bot-state.json");
const RULES_MARKER = "[PALLADIUM_RULES_V1]";

const BOT_TOKEN =
  process.env.DISCORD_COMMUNITY_BOT_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  tryReadGitConfig("discord.communityBotToken") ||
  tryReadGitConfig("discord.botToken") ||
  "";

const WELCOME_CHANNEL_ID =
  process.env.DISCORD_WELCOME_CHANNEL_ID ||
  tryReadGitConfig("discord.welcomeChannelId") ||
  "";

const RULES_CHANNEL_ID =
  process.env.DISCORD_RULES_CHANNEL_ID ||
  tryReadGitConfig("discord.rulesChannelId") ||
  "";

let GUILD_ID =
  process.env.DISCORD_GUILD_ID ||
  tryReadGitConfig("discord.communityGuildId") ||
  "";

const DEFAULT_RULES_TEXT = [
  "1. Be respectful to everyone.",
  "2. No hate speech, harassment, or threats.",
  "3. No spam or scams.",
  "4. Keep channels on-topic.",
  "5. Follow Discord Terms of Service.",
].join("\n");

const RULES_TEXT =
  process.env.DISCORD_RULES_TEXT ||
  tryReadGitConfig("discord.rulesText") ||
  DEFAULT_RULES_TEXT;

if (!BOT_TOKEN) {
  console.error("Missing community bot token. Set DISCORD_COMMUNITY_BOT_TOKEN or git config discord.communityBotToken.");
  process.exit(1);
}

if (!WELCOME_CHANNEL_ID || !RULES_CHANNEL_ID) {
  console.error("Missing welcome/rules channels. Set discord.welcomeChannelId and discord.rulesChannelId.");
  process.exit(1);
}

const state = loadState();
if (!Array.isArray(state.knownMemberIds)) state.knownMemberIds = [];
if (typeof state.bootstrapped !== "boolean") state.bootstrapped = false;
if (typeof state.lastRulesCheck !== "number") state.lastRulesCheck = 0;

let botUser = null;
let memberPollingEnabled = true;

function tryReadGitConfig(key) {
  if (!key) return "";
  try {
    return execSync(`git config --get ${key}`, {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return {};
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Non-fatal.
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function sortSnowflakeAsc(values) {
  return [...values].sort((a, b) => {
    try {
      const aid = BigInt(String(a || "0"));
      const bid = BigInt(String(b || "0"));
      if (aid < bid) return -1;
      if (aid > bid) return 1;
      return 0;
    } catch {
      return String(a || "").localeCompare(String(b || ""));
    }
  });
}

function limitKnownMembers(ids, max = 15000) {
  if (ids.length <= max) return ids;
  const sorted = sortSnowflakeAsc(ids);
  return sorted.slice(sorted.length - max);
}

async function discordRequest(method, route, body) {
  while (true) {
    const response = await fetch(`${DISCORD_API_BASE}${route}`, {
      method,
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 429) {
      let retryMs = 1500;
      try {
        const data = await response.json();
        if (data && typeof data.retry_after === "number") {
          retryMs = Math.ceil(data.retry_after * 1000);
        }
      } catch {
        // Use default retry.
      }
      await sleep(retryMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Discord API ${method} ${route} failed (${response.status}): ${text}`);
    }

    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
}

async function resolveGuildId() {
  if (GUILD_ID) return GUILD_ID;
  const welcomeChannel = await discordRequest("GET", `/channels/${WELCOME_CHANNEL_ID}`);
  if (!welcomeChannel || !welcomeChannel.guild_id) {
    throw new Error("Unable to resolve guild_id from welcome channel.");
  }
  GUILD_ID = String(welcomeChannel.guild_id);
  return GUILD_ID;
}

async function fetchAllMembers(guildId) {
  const members = [];
  let after = "0";

  while (true) {
    const batch = await discordRequest("GET", `/guilds/${guildId}/members?limit=1000&after=${after}`);
    const list = Array.isArray(batch) ? batch : [];
    if (!list.length) break;

    members.push(...list);

    const last = list[list.length - 1];
    if (!last || !last.user || !last.user.id) break;
    after = String(last.user.id);

    if (list.length < 1000) break;
  }

  return members;
}

function isAccessDeniedError(error) {
  const message = String(error && error.message ? error.message : error);
  return (
    message.includes("failed (403)") &&
    (message.includes("50001") || message.toLowerCase().includes("missing access"))
  );
}

function extractMemberId(member) {
  if (!member || !member.user || !member.user.id) return "";
  return String(member.user.id);
}

async function postWelcome(memberId) {
  if (!memberId) return;
  await discordRequest("POST", `/channels/${WELCOME_CHANNEL_ID}/messages`, {
    content: `Welcome <@${memberId}> to Palladium! Please read the rules in <#${RULES_CHANNEL_ID}>.`,
  });
}

async function ensureRulesMessage() {
  const now = Date.now();
  if (now - state.lastRulesCheck < RULES_CHECK_MS) return;

  const messages = await discordRequest("GET", `/channels/${RULES_CHANNEL_ID}/messages?limit=50`);
  const list = Array.isArray(messages) ? messages : [];
  const markerPresent = list.some((message) => {
    const content = String(message && message.content ? message.content : "");
    return content.includes(RULES_MARKER);
  });

  if (!markerPresent) {
    await discordRequest("POST", `/channels/${RULES_CHANNEL_ID}/messages`, {
      content: `${RULES_MARKER}\n**Palladium Rules**\n${RULES_TEXT}`,
    });
  }

  state.lastRulesCheck = now;
  saveState();
}

async function initialize() {
  await resolveGuildId();
  botUser = await discordRequest("GET", "/users/@me");

  try {
    const members = await fetchAllMembers(GUILD_ID);
    const ids = members.map(extractMemberId).filter(Boolean);

    if (!state.bootstrapped) {
      state.knownMemberIds = limitKnownMembers(Array.from(new Set(ids)));
      state.bootstrapped = true;
      saveState();
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error;
    }
    memberPollingEnabled = false;
    state.bootstrapped = true;
    saveState();
    console.warn(
      "Community bot cannot list guild members (Missing Access). " +
      "Welcome messages are disabled until Server Members Intent/permissions are fixed."
    );
  }

  await ensureRulesMessage();

  console.log(
    `Community bot ready as ${botUser && botUser.username ? botUser.username : "bot"} in guild ${GUILD_ID}` +
    (memberPollingEnabled ? "" : " (rules-only mode)")
  );
}

async function pollLoop() {
  while (true) {
    try {
      if (memberPollingEnabled) {
        const members = await fetchAllMembers(GUILD_ID);
        const currentIds = members.map(extractMemberId).filter(Boolean);
        const knownSet = new Set(state.knownMemberIds.map(String));

        const newMembers = currentIds.filter((id) => !knownSet.has(String(id)));
        for (const memberId of sortSnowflakeAsc(newMembers)) {
          await postWelcome(memberId);
        }

        state.knownMemberIds = limitKnownMembers(Array.from(new Set(currentIds.map(String))));
        saveState();
      }

      await ensureRulesMessage();
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      if (memberPollingEnabled && isAccessDeniedError(error)) {
        memberPollingEnabled = false;
        console.warn(
          "Community bot lost member-list access (Missing Access). " +
          "Continuing in rules-only mode."
        );
      } else {
        console.error(`Community bot poll error: ${msg}`);
      }
    }

    await sleep(POLL_MS);
  }
}

initialize()
  .then(pollLoop)
  .catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    process.exit(1);
  });

#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { startDiscordPresence } = require("./discord-gateway-presence");

const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const APPS_BASE = (process.env.PALLADIUM_APPS_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const POLL_MS = Number(process.env.DISCORD_LINK_POLL_MS || 3500);
const COMMAND_SYNC_MS = Number(process.env.DISCORD_LINK_COMMAND_SYNC_MS || 10 * 60 * 1000);
const STATE_PATH = process.env.DISCORD_LINK_STATE_PATH || path.join(__dirname, "..", ".discord-link-command-state.json");
const LINK_COMMAND_NAME = "link";

const BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN ||
  tryReadGitConfig("discord.botToken") ||
  "";

const CHANNEL_IDS = parseChannelIds(
  process.env.DISCORD_LINK_COMMAND_CHANNEL_IDS ||
  tryReadGitConfig("discord.linkCommandChannelIds") ||
  tryReadGitConfig("discord.linkCheckerChannelId") ||
  ""
);

if (!BOT_TOKEN) {
  console.error("Missing DISCORD_BOT_TOKEN (or git config discord.botToken).");
  process.exit(1);
}

if (!CHANNEL_IDS.length) {
  console.error("Missing DISCORD_LINK_COMMAND_CHANNEL_IDS (or git config discord.linkCommandChannelIds). Ex: 123,456");
  process.exit(1);
}

const state = loadState();
if (!state.lastMessageIds || typeof state.lastMessageIds !== "object") state.lastMessageIds = {};
if (!state.bootstrapped || typeof state.bootstrapped !== "object") state.bootstrapped = {};

let appId = "";
let guildIds = [];
let lastCommandSyncAt = 0;

function tryReadGitConfig(key) {
  if (!key) return "";
  try {
    return execSync(`git config --get ${key}`, {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r/g, "").trim();
  } catch {
    return "";
  }
}

function parseChannelIds(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.map((v) => String(v).trim()).filter(Boolean)));
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
    // Non-fatal: in-memory state still prevents duplicates during this run.
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
        // Use fallback retry.
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

async function interactionCallback(interactionId, interactionToken, body) {
  const response = await fetch(`${DISCORD_API_BASE}/interactions/${interactionId}/${interactionToken}/callback`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Interaction callback failed (${response.status}): ${text}`);
  }
}

async function interactionEditOriginal(interactionToken, body) {
  if (!appId) {
    appId = await resolveAppId();
  }
  if (!appId) {
    throw new Error("Unable to resolve application id for interaction follow-up.");
  }

  const response = await fetch(`${DISCORD_API_BASE}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Interaction edit failed (${response.status}): ${text}`);
  }
}

function decodeBotIdFromToken(token) {
  const value = String(token || "");
  const segment = value.split(".")[0];
  if (!segment) return "";
  try {
    return Buffer.from(segment, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

async function resolveAppId() {
  if (appId) return appId;

  try {
    const appInfo = await discordRequest("GET", "/oauth2/applications/@me");
    if (appInfo && appInfo.id) {
      appId = String(appInfo.id);
      return appId;
    }
  } catch {
    // Fall back to token-derived bot id.
  }

  const derived = decodeBotIdFromToken(BOT_TOKEN);
  if (derived) {
    appId = derived;
  }

  return appId;
}

function normalizeUrl(candidateRaw) {
  let candidate = String(candidateRaw || "").trim();
  if (!candidate) return "";

  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }

  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.href;
  } catch {
    return "";
  }
}

function parseLinkCommand(content) {
  const text = String(content || "").trim();
  if (!text) return "";

  const match = text.match(/^\/link\s+(.+)$/i);
  if (!match) return "";

  return normalizeUrl(match[1]);
}

function getSlashOptionValue(interactionData, name) {
  const options = interactionData && Array.isArray(interactionData.options) ? interactionData.options : [];
  const item = options.find((option) => option && option.name === name);
  return item && typeof item.value !== "undefined" ? item.value : "";
}

async function runLinkCheck(url) {
  const endpoint = `${APPS_BASE}/link-check?url=${encodeURIComponent(url)}`;
  const response = await fetch(endpoint, { method: "GET" });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok || !data || data.ok !== true) {
    throw new Error((data && data.error) || `Link check failed with HTTP ${response.status}`);
  }
  return data;
}

const PROVIDER_STYLE = {
  securly: { icon: "⚙️", label: "Securly" },
  lightspeed: { icon: "🔧", label: "Lightspeed" },
  goguardian: { icon: "🔒", label: "GoGuardian" },
  palo_alto: { icon: "🔥", label: "Palo Alto" },
  contentkeeper: { icon: "🔑", label: "ContentKeeper" },
  fortiguard: { icon: "🛡️", label: "FortiGuard" },
  blocksi: { icon: "🧱", label: "Blocksi" },
  linewize: { icon: "🌐", label: "Linewize" },
  cisco_talos: { icon: "☁️", label: "Cisco Talos" },
  aristotle: { icon: "🎓", label: "Aristotle" },
  lanschool: { icon: "📚", label: "LanSchool" },
  deledao: { icon: "🤖", label: "Deledao" },
};

function verdictColor(result) {
  const verdict = result && result.summary ? result.summary.verdict : "unknown";
  if (verdict === "likely_unblocked") return 0x22c55e;
  if (verdict === "likely_blocked") return 0xef4444;
  return 0xf59e0b;
}

function clamp(value, max = 950) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function safeHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function providerStatus(provider) {
  const status = provider && provider.status ? provider.status : "unknown";
  if (status === "detected") {
    return { mark: "⛔", label: "Blocked", pass: false };
  }
  if (status === "not_detected") {
    return { mark: "✅", label: "Allowed", pass: true };
  }
  return { mark: "⚪", label: "Unknown", pass: false, unknown: true };
}

function providerCategory(provider) {
  if (!provider || typeof provider !== "object") return "Unknown";

  if (provider.status === "detected") {
    return "Known block-page signature";
  }
  if (provider.status === "not_detected") {
    return "No known block signature detected";
  }

  const note = String(provider && provider.note ? provider.note : "").toLowerCase();
  if (note.includes("matched signature")) return "Known block-page signature";
  if (note.includes("could not be completed")) return "Probe unavailable";
  if (note.includes("no known block-page")) return "No known block signature detected";
  return "Insufficient signal";
}

function overallLine(providers) {
  const list = Array.isArray(providers) ? providers : [];
  const total = list.length;
  if (!total) return { text: "No provider data available", passCount: 0, total: 0 };

  let passCount = 0;
  let blockedCount = 0;
  let unknownCount = 0;

  for (const provider of list) {
    const status = providerStatus(provider);
    if (status.pass) passCount += 1;
    else if (status.unknown) unknownCount += 1;
    else blockedCount += 1;
  }

  const clearPct = Math.round((passCount / total) * 100);
  let headline = "Inconclusive";
  if (blockedCount === 0 && unknownCount === 0) headline = "Likely Unblocked";
  else if (blockedCount === total) headline = "Likely Blocked";
  else if (blockedCount > 0 && passCount > 0) headline = "Partially Blocked";
  else if (blockedCount > 0) headline = "Likely Blocked";

  return {
    text: `${headline} • ${clearPct}% clear • ${passCount}/${total} passed`,
    passCount,
    total,
  };
}

function buildProviderFields(result) {
  const providers = Array.isArray(result && result.providers) ? result.providers : [];
  return providers.slice(0, 18).map((provider) => {
    const style = PROVIDER_STYLE[provider.id] || { icon: "🔍", label: provider.name || provider.id || "Provider" };
    const status = providerStatus(provider);
    const category = providerCategory(provider);
    return {
      name: `${style.icon} ${style.label}`.slice(0, 256),
      value: clamp(`${status.mark} **${status.label}**\nCategory: ${category}`, 1024),
      inline: true,
    };
  });
}

function buildResultPayload(requesterMention, url, result, errorText) {
  if (errorText) {
    return {
      content: `${requesterMention} requested a filter check for ${url}`.slice(0, 1800),
      embeds: [
        {
          title: "🔍 Filter Analysis",
          color: 0xef4444,
          description: [
            `**${safeHost(url)}**`,
            "",
            `❌ **Failed**`,
            "",
            `Error: ${clamp(errorText, 500)}`
          ].join("\n"),
          fields: [
            { name: "Requested By", value: requesterMention, inline: true },
            { name: "URL", value: clamp(url, 900), inline: false }
          ],
          footer: { text: "Palladium Link Intelligence" },
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  const summaryText = (result && result.summary && result.summary.text) || "No summary returned.";
  const directProbe = result && result.probes ? result.probes.direct : null;
  const directState = directProbe
    ? (directProbe.reachable ? `${directProbe.ok ? "ok" : "not-ok"} (HTTP ${directProbe.status})` : `unreachable${directProbe.error ? ` (${directProbe.error})` : ""}`)
    : "unknown";

  const providers = Array.isArray(result && result.providers) ? result.providers : [];
  const overview = overallLine(providers);
  const providerFields = buildProviderFields(result);

  const fields = [
    { name: "Requested By", value: requesterMention, inline: true },
    { name: "Direct Probe", value: clamp(directState, 900), inline: true },
    { name: "URL", value: clamp(url, 900), inline: false },
    ...providerFields,
  ].slice(0, 25);

  return {
    embeds: [
      {
        title: "🔍 Filter Analysis",
        description: [
          `**${safeHost(url)}**`,
          "",
          `**${overview.text}**`,
          "",
          `[Open URL](${url})`,
          "",
          `Summary: ${summaryText}`
        ].join("\n"),
        color: verdictColor(result),
        fields,
        footer: { text: "Palladium Link Intelligence" },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
async function postResult(channelId, message, url, result, errorText) {
  const requesterId = message && message.author ? message.author.id : "";
  const requesterMention = requesterId ? `<@${requesterId}>` : "Someone";
  const payload = buildResultPayload(requesterMention, url, result, errorText);
  await discordRequest("POST", `/channels/${channelId}/messages`, payload);
}

function sortBySnowflakeAsc(messages) {
  return [...messages].sort((a, b) => {
    try {
      const aid = BigInt(a.id || "0");
      const bid = BigInt(b.id || "0");
      if (aid < bid) return -1;
      if (aid > bid) return 1;
      return 0;
    } catch {
      return String(a.id || "").localeCompare(String(b.id || ""));
    }
  });
}

async function pollChannel(channelId) {
  const lastMessageId = state.lastMessageIds[channelId] || "";
  const route = `/channels/${channelId}/messages?limit=50${lastMessageId ? `&after=${lastMessageId}` : ""}`;
  const messages = await discordRequest("GET", route);
  const list = Array.isArray(messages) ? messages : [];

  if (!state.bootstrapped[channelId]) {
    if (list.length) {
      const newest = sortBySnowflakeAsc(list).at(-1);
      if (newest && newest.id) state.lastMessageIds[channelId] = newest.id;
    }
    state.bootstrapped[channelId] = true;
    saveState();
    return;
  }

  if (!list.length) return;

  const ordered = sortBySnowflakeAsc(list);
  for (const message of ordered) {
    if (!message || !message.id) continue;

    state.lastMessageIds[channelId] = message.id;

    const isBotAuthor = !!(message.author && message.author.bot);
    if (isBotAuthor) continue;

    const commandUrl = parseLinkCommand(message.content || "");
    if (!commandUrl) continue;

    try {
      const result = await runLinkCheck(commandUrl);
      await postResult(channelId, message, commandUrl, result, "");
    } catch (error) {
      const msg = (error && error.message) ? error.message : "Unknown error";
      await postResult(channelId, message, commandUrl, null, msg);
    }
  }

  saveState();
}

async function resolveGuildIds() {
  const ids = [];
  for (const channelId of CHANNEL_IDS) {
    try {
      const channel = await discordRequest("GET", `/channels/${channelId}`);
      if (channel && channel.guild_id) {
        ids.push(String(channel.guild_id));
      }
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      console.warn(`Unable to resolve guild for channel ${channelId}: ${msg}`);
    }
  }
  guildIds = unique(ids);
  return guildIds;
}

function buildSlashCommandPayload() {
  return {
    name: LINK_COMMAND_NAME,
    description: "Check if a link is reachable and likely blocked/unblocked.",
    options: [
      {
        type: 3,
        name: "url",
        description: "URL to check",
        required: true,
      },
    ],
  };
}

async function upsertGuildCommand(guildId, commandPayload) {
  const commands = await discordRequest("GET", `/applications/${appId}/guilds/${guildId}/commands`);
  const list = Array.isArray(commands) ? commands : [];
  const existing = list.find((cmd) => cmd && cmd.name === LINK_COMMAND_NAME);

  if (!existing || !existing.id) {
    await discordRequest("POST", `/applications/${appId}/guilds/${guildId}/commands`, commandPayload);
    return;
  }

  await discordRequest("PATCH", `/applications/${appId}/guilds/${guildId}/commands/${existing.id}`, commandPayload);
}

async function ensureSlashCommands() {
  if (!appId) {
    appId = await resolveAppId();
  }

  const resolvedGuildIds = guildIds.length ? guildIds : await resolveGuildIds();
  if (!resolvedGuildIds.length || !appId) return;

  const payload = buildSlashCommandPayload();
  for (const guildId of resolvedGuildIds) {
    try {
      await upsertGuildCommand(guildId, payload);
      console.log(`Registered /${LINK_COMMAND_NAME} in guild ${guildId}`);
    } catch (error) {
      const msg = error && error.message ? error.message : String(error);
      console.warn(`Failed to register /${LINK_COMMAND_NAME} in guild ${guildId}: ${msg}`);
    }
  }

  lastCommandSyncAt = Date.now();
}

function interactionUserId(interaction) {
  if (interaction && interaction.member && interaction.member.user && interaction.member.user.id) {
    return String(interaction.member.user.id);
  }
  if (interaction && interaction.user && interaction.user.id) {
    return String(interaction.user.id);
  }
  return "";
}

async function handleSlashLinkInteraction(interaction) {
  const channelId = String(interaction && interaction.channel_id ? interaction.channel_id : "");
  if (!channelId) return;

  if (!CHANNEL_IDS.includes(channelId)) {
    await interactionCallback(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: "This command is not enabled in this channel.",
      },
    });
    return;
  }

  const rawUrl = getSlashOptionValue(interaction.data, "url");
  const url = normalizeUrl(rawUrl);

  if (!url) {
    await interactionCallback(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: "Please provide a valid http(s) URL.",
      },
    });
    return;
  }

  const requesterId = interactionUserId(interaction);
  const requesterMention = requesterId ? `<@${requesterId}>` : "Someone";

  try {
    await interactionCallback(interaction.id, interaction.token, {
      type: 5,
    });

    const result = await runLinkCheck(url);
    const payload = buildResultPayload(requesterMention, url, result, "");
    await interactionEditOriginal(interaction.token, payload);
  } catch (error) {
    const msg = error && error.message ? error.message : "Unknown error";
    try {
      await interactionEditOriginal(interaction.token, {
        flags: 64,
        content: `${requesterMention} link check failed for ${url}: ${msg}`,
      });
    } catch {
      try {
        await interactionCallback(interaction.id, interaction.token, {
          type: 4,
          data: {
            flags: 64,
            content: `${requesterMention} link check failed for ${url}: ${msg}`,
          },
        });
      } catch {
        // Interaction already acknowledged or expired.
      }
    }
  }
}

async function handleGatewayDispatch(eventType, eventData) {
  if (eventType !== "INTERACTION_CREATE") return;
  if (!eventData || eventData.type !== 2 || !eventData.data) return;
  if (String(eventData.data.name || "").toLowerCase() !== LINK_COMMAND_NAME) return;
  await handleSlashLinkInteraction(eventData);
}

const presence = startDiscordPresence({
  token: BOT_TOKEN,
  intents: 1,
  status: "online",
  logPrefix: "Palladium Links",
  activity: {
    name: "/link requests",
    type: 3,
  },
  onReady: async () => {
    await ensureSlashCommands();
  },
  onDispatch: handleGatewayDispatch,
});

async function mainLoop() {
  await ensureSlashCommands();
  console.log(`Palladium link command bot running for channels: ${CHANNEL_IDS.join(", ")}`);
  while (true) {
    const shouldSyncCommands = !lastCommandSyncAt || (Date.now() - lastCommandSyncAt) >= COMMAND_SYNC_MS;
    if (shouldSyncCommands) {
      try {
        await ensureSlashCommands();
      } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        console.warn(`Slash command sync error: ${msg}`);
      }
    }

    for (const channelId of CHANNEL_IDS) {
      try {
        await pollChannel(channelId);
      } catch (error) {
        const msg = error && error.message ? error.message : String(error);
        console.error(`Channel ${channelId} poll error: ${msg}`);
      }
    }
    await sleep(POLL_MS);
  }
}

function shutdown(code) {
  try {
    presence.stop();
  } catch {
    // Ignore shutdown errors.
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

mainLoop().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  shutdown(1);
});

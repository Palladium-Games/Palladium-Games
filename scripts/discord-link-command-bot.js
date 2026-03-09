#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { startDiscordPresence } = require("./discord-gateway-presence");

const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const APPS_BASE = (process.env.PALLADIUM_APPS_URL || "http://localhost:1338").replace(/\/$/, "");
const POLL_MS = Number(process.env.DISCORD_LINK_POLL_MS || 3500);
const STATE_PATH = process.env.DISCORD_LINK_STATE_PATH || path.join(__dirname, "..", ".discord-link-command-state.json");

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

const presence = startDiscordPresence({
  token: BOT_TOKEN,
  intents: 0,
  status: "online",
  logPrefix: "Palladium Links",
  activity: {
    name: "/link requests",
    type: 3,
  },
});

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

function parseChannelIds(raw) {
  return String(raw || "")
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
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

function parseLinkCommand(content) {
  const text = String(content || "").trim();
  if (!text) return "";

  const match = text.match(/^\/link\s+(.+)$/i);
  if (!match) return "";

  let candidate = match[1].trim();
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

function summarizeProviders(result) {
  const providers = Array.isArray(result && result.summary && result.summary.detectedProviders)
    ? result.summary.detectedProviders
    : [];
  if (!providers.length) return "None detected";
  return providers.join(", ");
}

function verdictColor(result) {
  const verdict = result && result.summary ? result.summary.verdict : "unknown";
  if (verdict === "likely_unblocked") return 0x22c55e;
  if (verdict === "likely_blocked") return 0xef4444;
  return 0xf59e0b;
}

async function postResult(channelId, message, url, result, errorText) {
  const requesterId = message && message.author ? message.author.id : "";
  const requesterMention = requesterId ? `<@${requesterId}>` : "Someone";

  if (errorText) {
    await discordRequest("POST", `/channels/${channelId}/messages`, {
      content: `${requesterMention} requested link check for ${url}\nResult: ${errorText}`,
    });
    return;
  }

  const summaryText = (result && result.summary && result.summary.text) || "No summary returned.";
  const detected = summarizeProviders(result);
  const directProbe = result && result.probes ? result.probes.direct : null;
  const directState = directProbe
    ? (directProbe.reachable ? `${directProbe.ok ? "ok" : "not-ok"} (HTTP ${directProbe.status})` : `unreachable${directProbe.error ? ` (${directProbe.error})` : ""}`)
    : "unknown";

  await discordRequest("POST", `/channels/${channelId}/messages`, {
    content: `${requesterMention} requested link check for ${url}`,
    embeds: [
      {
        title: "Palladium Link Check",
        description: `[Open URL](${url})`,
        color: verdictColor(result),
        fields: [
          { name: "Verdict", value: summaryText.slice(0, 950) || "Unknown", inline: false },
          { name: "Detected Filters", value: detected.slice(0, 950), inline: false },
          { name: "Direct Probe", value: directState.slice(0, 950), inline: false },
        ],
        footer: { text: "Palladium Link Command Bot" },
        timestamp: new Date().toISOString(),
      },
    ],
  });
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

async function mainLoop() {
  console.log(`Palladium link command bot running for channels: ${CHANNEL_IDS.join(", ")}`);
  while (true) {
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

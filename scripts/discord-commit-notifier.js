#!/usr/bin/env node

const http = require("http");
const https = require("https");
const path = require("path");
const { execSync } = require("child_process");

const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";

function run(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryRun(command, fallback = "") {
  try {
    return run(command);
  } catch {
    return fallback;
  }
}

function clamp(text, max) {
  const raw = String(text || "");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, Math.max(0, max - 1))}…`;
}

function remoteToHttps(remote) {
  const value = String(remote || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    return value.replace(/\.git$/i, "");
  }
  const sshMatch = value.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
  if (!sshMatch) return "";
  return `https://${sshMatch[1]}/${sshMatch[2]}`.replace(/\.git$/i, "");
}

function buildCommitUrl(remote, fullHash) {
  const base = remoteToHttps(remote);
  if (!base || !fullHash) return "";
  if (/github\.com/i.test(base)) return `${base}/commit/${fullHash}`;
  return "";
}

function githubUsernameFromRemote(remote) {
  const base = remoteToHttps(remote);
  if (!base) return "";
  try {
    const parsed = new URL(base);
    if (!/github\.com$/i.test(parsed.hostname)) return "";
    const parts = parsed.pathname.replace(/^\/+/, "").split("/");
    return parts[0] || "";
  } catch {
    return "";
  }
}

function postJson(targetUrl, payload, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(targetUrl);
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(
      {
        method: "POST",
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          ...extraHeaders,
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk.toString("utf8");
        });
        res.on("end", () => {
          if ((res.statusCode >= 200 && res.statusCode < 300) || res.statusCode === 204) {
            resolve();
            return;
          }
          reject(new Error(`Discord post failed (${res.statusCode}): ${responseBody}`));
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function postViaBot(token, channelId, embed) {
  const endpoint = `${DISCORD_API_BASE}/channels/${channelId}/messages`;
  await postJson(
    endpoint,
    { embeds: [embed] },
    { Authorization: `Bot ${token}` }
  );
}

async function postViaWebhook(webhookUrl, botName, embed) {
  await postJson(webhookUrl, {
    username: botName,
    embeds: [embed],
  });
}

async function main() {
  const BOT_NAME = "Palladium Commits";

  const webhookUrl =
    process.argv[2] ||
    process.env.DISCORD_WEBHOOK_URL ||
    tryRun("git config --get discord.webhookUrl");

  const botToken =
    process.env.DISCORD_COMMIT_BOT_TOKEN ||
    process.env.DISCORD_BOT_TOKEN ||
    tryRun("git config --get discord.commitBotToken") ||
    tryRun("git config --get discord.botToken");

  const commitChannelId =
    process.env.DISCORD_COMMIT_CHANNEL_ID ||
    tryRun("git config --get discord.commitChannelId");

  if (!(botToken && commitChannelId) && !webhookUrl) {
    console.error("No Discord destination configured. Set bot token + commit channel, or webhook URL.");
    process.exit(1);
  }

  const repoRoot = tryRun("git rev-parse --show-toplevel");
  const detectedRepoName = repoRoot ? path.basename(repoRoot) : "Repository";
  const projectName =
    process.env.DISCORD_PROJECT_NAME ||
    tryRun("git config --get discord.projectName") ||
    (detectedRepoName.toUpperCase() === "TITANIUM" ? "PALLADIUM" : detectedRepoName);
  const branch = tryRun("git rev-parse --abbrev-ref HEAD", "unknown");
  const hash = tryRun("git rev-parse HEAD", "");
  const shortHash = tryRun("git rev-parse --short HEAD", "");
  const subject = tryRun("git log -1 --pretty=%s", "Commit");
  const body = tryRun("git log -1 --pretty=%b", "");
  const authoredAt = tryRun("git log -1 --date=iso-strict --pretty=%cI", new Date().toISOString());
  const changedFiles = tryRun("git show --name-only --pretty= --diff-filter=ACDMRT HEAD", "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  const remote = tryRun("git config --get remote.origin.url");
  const commitUrl = buildCommitUrl(remote, hash);

  const shownFiles = changedFiles.slice(0, 12).map((file) => `• ${file}`).join("\n");
  const extraCount = Math.max(0, changedFiles.length - 12);
  const filesFieldValue = changedFiles.length
    ? clamp(`${shownFiles}${extraCount ? `\n• ...and ${extraCount} more` : ""}`, 1000)
    : "No file list available.";

  const description = commitUrl
    ? `[\`${shortHash}\`](${commitUrl}) ${subject}`
    : `\`${shortHash}\` ${subject}`;

  let githubUsername =
    process.argv[3] ||
    process.env.GITHUB_USERNAME ||
    tryRun("git config --get github.username");
  if (!githubUsername) {
    githubUsername = githubUsernameFromRemote(remote);
  }
  if (!githubUsername) githubUsername = "PALLADIUM";

  const embed = {
    title: `New Commit in ${projectName}`,
    description: clamp(description, 300),
    url: commitUrl || undefined,
    color: 0x3b82f6,
    fields: [
      { name: "Branch", value: `\`${branch}\``, inline: true },
      { name: "Posted By", value: clamp(githubUsername, 200), inline: true },
      { name: "Files Changed", value: `${changedFiles.length}`, inline: true },
      { name: "Commit Message", value: clamp(body || subject, 1000), inline: false },
      { name: "File List", value: filesFieldValue, inline: false },
    ],
    timestamp: authoredAt,
    footer: { text: "Palladium Commit Updates" },
  };

  if (botToken && commitChannelId) {
    await postViaBot(botToken, commitChannelId, embed);
    console.log("Discord commit notification sent via bot token.");
    return;
  }

  await postViaWebhook(webhookUrl, BOT_NAME, embed);
  console.log("Discord commit notification sent via webhook.");
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});

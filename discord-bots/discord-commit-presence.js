#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");
const { startDiscordPresence } = require("./discord-gateway-presence");

const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const GITHUB_API_BASE = (process.env.DISCORD_COMMIT_GITHUB_API_BASE || "https://api.github.com").replace(/\/+$/, "");
const POLL_MS = Math.max(5000, Number(process.env.DISCORD_COMMIT_POLL_MS || 15000));
const FETCH_LIMIT = Math.max(5, Math.min(40, Number(process.env.DISCORD_COMMIT_FETCH_LIMIT || 20)));
const STATE_PATH = process.env.DISCORD_COMMIT_STATE_PATH || path.join(__dirname, "..", ".discord-commit-bot-state.json");

function tryReadGitConfig(key) {
  if (!key) return "";
  try {
    return execSync(`git config --get ${key}`, {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .replace(/\r/g, "")
      .trim();
  } catch {
    return "";
  }
}

function tryReadCurrentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .replace(/\r/g, "")
      .trim();
  } catch {
    return "";
  }
}

function tryReadOriginRemote() {
  return tryReadGitConfig("remote.origin.url");
}

function parseGithubRepo(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const shortMatch = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return { owner: shortMatch[1], name: shortMatch[2] };
  }

  const sshMatch = raw.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) {
    return { owner: sshMatch[1], name: sshMatch[2] };
  }

  const httpsMatch = raw.match(/^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  if (httpsMatch) {
    return { owner: httpsMatch[1], name: httpsMatch[2] };
  }

  return null;
}

function truncate(value, max = 1000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function cleanMessageFirstLine(message) {
  return String(message || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "No commit message";
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Non-fatal.
  }
}

const BOT_TOKEN =
  process.env.DISCORD_COMMIT_BOT_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  tryReadGitConfig("discord.commitBotToken") ||
  tryReadGitConfig("discord.botToken") ||
  "";

const CHANNEL_ID =
  process.env.DISCORD_COMMIT_CHANNEL_ID ||
  tryReadGitConfig("discord.commitChannelId") ||
  "";

const GITHUB_TOKEN =
  process.env.DISCORD_COMMIT_GITHUB_TOKEN ||
  process.env.GITHUB_TOKEN ||
  tryReadGitConfig("discord.commitGithubToken") ||
  "";

const resolvedRepo =
  parseGithubRepo(process.env.DISCORD_COMMIT_REPO || "") ||
  parseGithubRepo(tryReadGitConfig("discord.commitRepo")) ||
  parseGithubRepo(tryReadOriginRemote());

const BRANCH =
  process.env.DISCORD_COMMIT_BRANCH ||
  tryReadGitConfig("discord.commitBranch") ||
  tryReadCurrentBranch() ||
  "main";

if (!BOT_TOKEN) {
  console.error("Missing commit bot token. Set DISCORD_COMMIT_BOT_TOKEN or git config discord.commitBotToken.");
  process.exit(1);
}

if (!CHANNEL_ID) {
  console.error("Missing DISCORD_COMMIT_CHANNEL_ID (or git config discord.commitChannelId).");
  process.exit(1);
}

if (!resolvedRepo) {
  console.error(
    "Missing GitHub repo. Set DISCORD_COMMIT_REPO to owner/repo or configure remote.origin.url to a GitHub repository."
  );
  process.exit(1);
}

const REPO = `${resolvedRepo.owner}/${resolvedRepo.name}`;
const REPO_LABEL = String(resolvedRepo.name || "repository").toUpperCase();
const REF_KEY = `${REPO}#${BRANCH}`;
const state = loadState();
if (!state.byRef || typeof state.byRef !== "object") state.byRef = {};

function getLastSha() {
  return String(state.byRef[REF_KEY] || state.lastSha || "").trim();
}

function setLastSha(sha) {
  const normalized = String(sha || "").trim();
  if (!normalized) return;
  state.byRef[REF_KEY] = normalized;
  state.lastSha = normalized;
  saveState(state);
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Palladium-Commit-Bot/1.0"
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${GITHUB_TOKEN}`;
  }
  return headers;
}

async function githubRequest(route) {
  while (true) {
    const response = await fetch(`${GITHUB_API_BASE}${route}`, {
      method: "GET",
      headers: githubHeaders()
    });

    if (response.status === 429) {
      await sleep(2000);
      continue;
    }

    if (response.status === 403) {
      const resetEpoch = Number(response.headers.get("x-ratelimit-reset") || 0);
      const remaining = Number(response.headers.get("x-ratelimit-remaining") || 0);
      if (remaining === 0 && resetEpoch > 0) {
        const waitMs = Math.max(1000, resetEpoch * 1000 - Date.now());
        await sleep(Math.min(waitMs, 60000));
        continue;
      }
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GitHub ${route} failed (${response.status}): ${text}`);
    }

    return response.json();
  }
}

async function fetchRecentCommits() {
  const route = `/repos/${resolvedRepo.owner}/${resolvedRepo.name}/commits?sha=${encodeURIComponent(BRANCH)}&per_page=${FETCH_LIMIT}`;
  const payload = await githubRequest(route);
  return Array.isArray(payload) ? payload : [];
}

async function fetchCommitDetail(sha) {
  const route = `/repos/${resolvedRepo.owner}/${resolvedRepo.name}/commits/${encodeURIComponent(sha)}`;
  return githubRequest(route);
}

async function discordRequest(method, route, body) {
  while (true) {
    const response = await fetch(`${DISCORD_API_BASE}${route}`, {
      method,
      headers: {
        Authorization: `Bot ${BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (response.status === 429) {
      let retryMs = 1500;
      try {
        const payload = await response.json();
        if (payload && typeof payload.retry_after === "number") {
          retryMs = Math.ceil(payload.retry_after * 1000);
        }
      } catch {
        // Ignore and use fallback retry.
      }
      await sleep(retryMs);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Discord ${method} ${route} failed (${response.status}): ${text}`);
    }

    return;
  }
}

function buildCommitEmbed(commitSummary, commitDetail) {
  const sha = String(commitSummary && commitSummary.sha ? commitSummary.sha : "");
  const shortSha = sha ? sha.slice(0, 7) : "unknown";
  const htmlUrl =
    String(commitSummary && commitSummary.html_url ? commitSummary.html_url : "") ||
    `https://github.com/${REPO}/commit/${sha}`;

  const message = cleanMessageFirstLine(
    (commitDetail && commitDetail.commit && commitDetail.commit.message) ||
      (commitSummary && commitSummary.commit && commitSummary.commit.message) ||
      ""
  );

  const author =
    String(
      (commitSummary && commitSummary.author && commitSummary.author.login) ||
        (commitDetail && commitDetail.author && commitDetail.author.login) ||
        (commitSummary && commitSummary.commit && commitSummary.commit.author && commitSummary.commit.author.name) ||
        "Unknown"
    ) || "Unknown";

  const commitDate =
    (commitSummary && commitSummary.commit && commitSummary.commit.author && commitSummary.commit.author.date) ||
    new Date().toISOString();

  const files = Array.isArray(commitDetail && commitDetail.files) ? commitDetail.files : [];
  const filesChanged = Number.isFinite(commitDetail && commitDetail.files && commitDetail.files.length)
    ? commitDetail.files.length
    : 0;
  const fileLines = files.slice(0, 10).map((file) => `• ${file.filename}`);
  if (files.length > 10) {
    fileLines.push(`• +${files.length - 10} more`);
  }
  const fileList = fileLines.length > 0 ? fileLines.join("\n") : "No file metadata available";

  return {
    title: `New Commit in ${REPO_LABEL}`,
    url: htmlUrl,
    color: 0x2563eb,
    fields: [
      { name: "Commit", value: `[\`${shortSha}\`](${htmlUrl})`, inline: true },
      { name: "Branch", value: BRANCH, inline: true },
      { name: "Posted By", value: author, inline: true },
      { name: "Files Changed", value: String(filesChanged), inline: true },
      { name: "Commit Message", value: truncate(message, 900), inline: false },
      { name: "File List", value: truncate(fileList, 1000), inline: false }
    ],
    timestamp: commitDate
  };
}

async function postCommit(commitSummary) {
  let detail = null;
  try {
    detail = await fetchCommitDetail(commitSummary.sha);
  } catch (error) {
    console.warn(`Failed to load commit details for ${commitSummary.sha}: ${String(error && error.message ? error.message : error)}`);
  }

  const payload = {
    embeds: [buildCommitEmbed(commitSummary, detail)],
    allowed_mentions: { parse: [] }
  };

  await discordRequest("POST", `/channels/${CHANNEL_ID}/messages`, payload);
}

async function pollRemoteCommits() {
  const commits = await fetchRecentCommits();
  if (!commits.length) return;

  const newestSha = String(commits[0].sha || "").trim();
  const lastSha = getLastSha();
  if (!newestSha) return;

  if (!lastSha) {
    setLastSha(newestSha);
    console.log(`Commit bot bootstrapped at ${newestSha.slice(0, 7)} (${REPO}@${BRANCH}).`);
    return;
  }

  if (lastSha === newestSha) return;

  const pending = [];
  for (const commit of commits) {
    const sha = String(commit && commit.sha ? commit.sha : "").trim();
    if (!sha) continue;
    if (sha === lastSha) break;
    pending.push(commit);
  }

  if (!pending.length) {
    pending.push(commits[0]);
  }

  pending.reverse();
  for (const commit of pending) {
    await postCommit(commit);
    setLastSha(commit.sha);
  }

  console.log(`Posted ${pending.length} new remote commit update(s) for ${REPO}@${BRANCH}.`);
}

const presence = startDiscordPresence({
  token: BOT_TOKEN,
  intents: 0,
  status: "online",
  logPrefix: "Palladium Commits",
  activity: {
    name: "remote commits",
    type: 3
  }
});

function shutdown(code) {
  try {
    presence.stop();
  } catch {
    // Ignore shutdown issues.
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`Palladium commit bot running for ${REPO}@${BRANCH} (poll ${POLL_MS}ms).`);

(async function loop() {
  while (true) {
    try {
      await pollRemoteCommits();
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      console.error(`Commit poll error: ${message}`);
    }
    await sleep(POLL_MS);
  }
})();

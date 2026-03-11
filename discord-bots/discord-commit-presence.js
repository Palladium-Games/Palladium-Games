#!/usr/bin/env node

const { execSync } = require("child_process");
const { startDiscordPresence } = require("./discord-gateway-presence");

function tryReadGitConfig(key) {
  if (!key) return "";
  try {
    return execSync(`git config --get ${key}`, {
      cwd: `${__dirname}/..`,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).replace(/\r/g, "").trim();
  } catch {
    return "";
  }
}

const BOT_TOKEN =
  process.env.DISCORD_COMMIT_BOT_TOKEN ||
  process.env.DISCORD_BOT_TOKEN ||
  tryReadGitConfig("discord.commitBotToken") ||
  tryReadGitConfig("discord.botToken") ||
  "";

if (!BOT_TOKEN) {
  console.error("Missing commit bot token. Set DISCORD_COMMIT_BOT_TOKEN or git config discord.commitBotToken.");
  process.exit(1);
}

const presence = startDiscordPresence({
  token: BOT_TOKEN,
  intents: 0,
  status: "online",
  logPrefix: "Palladium Commits",
  activity: {
    name: "new commits",
    type: 3,
  },
});

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

console.log("Palladium commit presence bot running.");
setInterval(() => {}, 60000);

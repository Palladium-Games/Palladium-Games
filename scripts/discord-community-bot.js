#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { startDiscordPresence } = require("./discord-gateway-presence");

const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";
const POLL_MS = Number(process.env.DISCORD_COMMUNITY_POLL_MS || 5000);
const RULES_CHECK_MS = Number(process.env.DISCORD_RULES_CHECK_MS || 5 * 60 * 1000);
const ROLE_CACHE_MS = Number(process.env.DISCORD_ROLE_CACHE_MS || 10 * 60 * 1000);
const STATE_PATH = process.env.DISCORD_COMMUNITY_STATE_PATH || path.join(__dirname, "..", ".discord-community-bot-state.json");
const RULES_EMBED_TITLE = "Palladium Rules";
const RULES_SIGNATURE = "palladium-rules-v1";
const RULES_COMMAND_NAME = "rules";

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

const CONFIGURED_COMMAND_CHANNEL_IDS = unique(
  parseChannelIds(
    process.env.DISCORD_COMMUNITY_COMMAND_CHANNEL_IDS ||
      tryReadGitConfig("discord.communityCommandChannelIds") ||
      ""
  )
);

let COMMAND_CHANNEL_IDS = [...CONFIGURED_COMMAND_CHANNEL_IDS];

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
if (typeof state.rulesMessageId !== "string") state.rulesMessageId = "";
if (!state.commandLastMessageIds || typeof state.commandLastMessageIds !== "object") state.commandLastMessageIds = {};
if (!state.commandBootstrapped || typeof state.commandBootstrapped !== "object") state.commandBootstrapped = {};

let botUser = null;
let memberPollingEnabled = true;
let guildRolesById = new Map();
let guildRolesFetchedAt = 0;
let guildInfo = null;
let appId = "";

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

function sortMessagesAsc(messages) {
  return [...messages].sort((a, b) => {
    try {
      const aid = BigInt(String((a && a.id) || "0"));
      const bid = BigInt(String((b && b.id) || "0"));
      if (aid < bid) return -1;
      if (aid > bid) return 1;
      return 0;
    } catch {
      const aid = String((a && a.id) || "");
      const bid = String((b && b.id) || "");
      return aid.localeCompare(bid);
    }
  });
}

function limitKnownMembers(ids, max = 15000) {
  if (ids.length <= max) return ids;
  const sorted = sortSnowflakeAsc(ids);
  return sorted.slice(sorted.length - max);
}

function parsePermissionBits(raw) {
  try {
    return BigInt(String(raw || "0"));
  } catch {
    return 0n;
  }
}

function hasPermission(permissionBits, mask) {
  const bits = parsePermissionBits(permissionBits);
  return (bits & mask) === mask;
}

function hasModeratorPermissions(bits) {
  const ADMINISTRATOR = 0x00000008n;
  const MANAGE_GUILD = 0x00000020n;
  const MANAGE_MESSAGES = 0x00002000n;
  return (
    hasPermission(bits, ADMINISTRATOR) ||
    hasPermission(bits, MANAGE_GUILD) ||
    hasPermission(bits, MANAGE_MESSAGES)
  );
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

async function fetchGuildInfo() {
  if (guildInfo && guildInfo.id) return guildInfo;
  guildInfo = await discordRequest("GET", `/guilds/${GUILD_ID}`);
  return guildInfo;
}

async function fetchGuildRoles() {
  const now = Date.now();
  if (guildRolesById.size > 0 && now - guildRolesFetchedAt < ROLE_CACHE_MS) {
    return guildRolesById;
  }

  const roles = await discordRequest("GET", `/guilds/${GUILD_ID}/roles`);
  const map = new Map();
  const list = Array.isArray(roles) ? roles : [];
  for (const role of list) {
    if (!role || !role.id) continue;
    map.set(String(role.id), role);
  }

  guildRolesById = map;
  guildRolesFetchedAt = now;
  return guildRolesById;
}

async function fetchGuildMember(userId) {
  if (!userId) return null;
  try {
    return await discordRequest("GET", `/guilds/${GUILD_ID}/members/${userId}`);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("failed (404)") || isAccessDeniedError(error)) return null;
    throw error;
  }
}

async function resolveCommandChannels() {
  if (COMMAND_CHANNEL_IDS.length) return COMMAND_CHANNEL_IDS;

  const defaults = [RULES_CHANNEL_ID, WELCOME_CHANNEL_ID];
  try {
    const channels = await discordRequest("GET", `/guilds/${GUILD_ID}/channels`);
    const textChannels = (Array.isArray(channels) ? channels : [])
      .filter((channel) => channel && (channel.type === 0 || channel.type === 5) && channel.id)
      .map((channel) => String(channel.id));
    COMMAND_CHANNEL_IDS = unique([...defaults, ...textChannels]).slice(0, 30);
    return COMMAND_CHANNEL_IDS;
  } catch {
    COMMAND_CHANNEL_IDS = unique(defaults);
    return COMMAND_CHANNEL_IDS;
  }
}

function buildRulesCommandPayload() {
  return {
    name: RULES_COMMAND_NAME,
    description: "Repost the server rules in the rules channel (admin/mod only)",
  };
}

async function upsertRulesCommand() {
  if (!GUILD_ID) return;

  if (!appId) {
    const appInfo = await discordRequest("GET", "/oauth2/applications/@me");
    appId = appInfo && appInfo.id ? String(appInfo.id) : "";
  }

  if (!appId) return;

  const commands = await discordRequest("GET", `/applications/${appId}/guilds/${GUILD_ID}/commands`);
  const list = Array.isArray(commands) ? commands : [];
  const existing = list.find((cmd) => cmd && cmd.name === RULES_COMMAND_NAME);
  const payload = buildRulesCommandPayload();

  if (!existing || !existing.id) {
    await discordRequest("POST", `/applications/${appId}/guilds/${GUILD_ID}/commands`, payload);
    console.log(`Registered /${RULES_COMMAND_NAME} in guild ${GUILD_ID}`);
    return;
  }

  await discordRequest("PATCH", `/applications/${appId}/guilds/${GUILD_ID}/commands/${existing.id}`, payload);
  console.log(`Updated /${RULES_COMMAND_NAME} in guild ${GUILD_ID}`);
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

function normalizeRules() {
  const lines = String(RULES_TEXT || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return ["Be respectful to everyone.", "Follow Discord Terms of Service."];
  }

  return lines.map((line) => line.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean);
}

function buildRulesEmbed() {
  const normalizedRules = normalizeRules().slice(0, 20);
  const fields = normalizedRules.map((rule, index) => ({
    name: `Rule ${index + 1}`,
    value: `- ${rule}`,
    inline: false,
  }));

  return {
    title: RULES_EMBED_TITLE,
    description: "Please read and follow these rules to keep Palladium fun, safe, and organized for everyone.",
    color: 0x60a5fa,
    fields,
    footer: {
      text: `Palladium Community • ${RULES_SIGNATURE}`,
    },
    timestamp: new Date().toISOString(),
  };
}

function isRulesMessage(message) {
  if (!message || typeof message !== "object") return false;

  const content = String(message.content || "");
  if (content.includes("[PALLADIUM_RULES_V1]")) return true;

  const embeds = Array.isArray(message.embeds) ? message.embeds : [];
  for (const embed of embeds) {
    const title = String((embed && embed.title) || "");
    const footerText = String((embed && embed.footer && embed.footer.text) || "").toLowerCase();
    if (title === RULES_EMBED_TITLE) return true;
    if (footerText.includes(RULES_SIGNATURE)) return true;
  }

  return false;
}

async function getMessageById(channelId, messageId) {
  if (!channelId || !messageId) return null;
  try {
    return await discordRequest("GET", `/channels/${channelId}/messages/${messageId}`);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("failed (404)")) return null;
    throw error;
  }
}

async function deleteMessage(channelId, messageId) {
  if (!channelId || !messageId) return;
  try {
    await discordRequest("DELETE", `/channels/${channelId}/messages/${messageId}`);
  } catch (error) {
    const msg = String(error && error.message ? error.message : error);
    if (msg.includes("failed (404)")) return;
    console.warn(`Unable to delete message ${messageId}: ${msg}`);
  }
}

async function postWelcome(memberId) {
  if (!memberId) return;
  await discordRequest("POST", `/channels/${WELCOME_CHANNEL_ID}/messages`, {
    content: `Welcome <@${memberId}> to Palladium! Please read the rules in <#${RULES_CHANNEL_ID}>.`,
  });
}

async function postRulesMessage(requestedById) {
  const content = requestedById
    ? `Rules refreshed by <@${requestedById}>.`
    : "Please read these rules before participating in the server.";

  return await discordRequest("POST", `/channels/${RULES_CHANNEL_ID}/messages`, {
    content,
    embeds: [buildRulesEmbed()],
  });
}

async function ensureRulesMessage(options = {}) {
  const forceRepost = !!options.forceRepost;
  const requestedById = options.requestedById ? String(options.requestedById) : "";
  const now = Date.now();

  if (!forceRepost && now - state.lastRulesCheck < RULES_CHECK_MS) {
    return { posted: false, messageId: state.rulesMessageId || "" };
  }

  let existing = null;
  if (state.rulesMessageId) {
    existing = await getMessageById(RULES_CHANNEL_ID, state.rulesMessageId);
    if (existing && !isRulesMessage(existing)) {
      existing = null;
      state.rulesMessageId = "";
      saveState();
    }
  }

  const recentMessages = await discordRequest("GET", `/channels/${RULES_CHANNEL_ID}/messages?limit=100`);
  const list = Array.isArray(recentMessages) ? recentMessages : [];

  const rulesMessages = sortMessagesAsc(
    list.filter((message) => {
      if (!isRulesMessage(message)) return false;
      if (!message || !message.id) return false;
      return true;
    })
  );

  if (!existing && rulesMessages.length) {
    existing = rulesMessages[rulesMessages.length - 1];
    state.rulesMessageId = String(existing.id);
    saveState();
  }

  if (!forceRepost && existing) {
    state.lastRulesCheck = now;
    saveState();
    return { posted: false, messageId: String(existing.id) };
  }

  for (const message of rulesMessages) {
    if (!message || !message.id) continue;
    await deleteMessage(RULES_CHANNEL_ID, String(message.id));
  }

  const posted = await postRulesMessage(requestedById);
  if (posted && posted.id) {
    state.rulesMessageId = String(posted.id);
  }

  state.lastRulesCheck = now;
  saveState();

  return { posted: true, messageId: state.rulesMessageId || "" };
}

function isRulesCommand(content) {
  const text = String(content || "").trim();
  if (!text) return false;
  return /^\/(rules)\b/i.test(text) || /^!(rules)\b/i.test(text);
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

async function isAdminByUserId(userId, permissionBitsFromPayload) {
  if (!userId) return false;

  if (typeof permissionBitsFromPayload !== "undefined" && hasModeratorPermissions(permissionBitsFromPayload)) {
    return true;
  }

  const freshMember = await fetchGuildMember(userId);
  if (freshMember) {
    if (typeof freshMember.permissions !== "undefined" && hasModeratorPermissions(freshMember.permissions)) {
      return true;
    }

    const memberRoles = Array.isArray(freshMember.roles) ? freshMember.roles.map((id) => String(id)) : [];
    if (memberRoles.length) {
      try {
        const rolesById = await fetchGuildRoles();
        for (const roleId of memberRoles) {
          const role = rolesById.get(roleId);
          if (!role) continue;
          if (hasModeratorPermissions(role.permissions)) return true;
        }
      } catch {
        // Continue to owner check.
      }
    }
  }

  try {
    const guild = await fetchGuildInfo();
    if (guild && guild.owner_id && String(guild.owner_id) === String(userId)) return true;
  } catch {
    // Ignore owner check failures.
  }

  return false;
}

async function isAdminMessage(message) {
  if (!message || !message.author || !message.author.id) return false;
  const permissionBits = message && message.member ? message.member.permissions : undefined;
  return await isAdminByUserId(String(message.author.id), permissionBits);
}

async function isAdminInteraction(interaction) {
  const userId = interactionUserId(interaction);
  const permissionBits = interaction && interaction.member ? interaction.member.permissions : undefined;
  return await isAdminByUserId(userId, permissionBits);
}

async function pollCommandChannel(channelId) {
  const lastMessageId = state.commandLastMessageIds[channelId] || "";
  const route = `/channels/${channelId}/messages?limit=50${lastMessageId ? `&after=${lastMessageId}` : ""}`;
  const messages = await discordRequest("GET", route);
  const list = Array.isArray(messages) ? messages : [];

  if (!state.commandBootstrapped[channelId]) {
    if (list.length) {
      const newest = sortMessagesAsc(list).at(-1);
      if (newest && newest.id) state.commandLastMessageIds[channelId] = String(newest.id);
    }
    state.commandBootstrapped[channelId] = true;
    saveState();
    return;
  }

  if (!list.length) return;

  const ordered = sortMessagesAsc(list);
  for (const message of ordered) {
    if (!message || !message.id) continue;

    state.commandLastMessageIds[channelId] = String(message.id);

    const isBotAuthor = !!(message.author && message.author.bot);
    if (isBotAuthor) continue;

    if (!isRulesCommand(message.content || "")) continue;

    const isAdmin = await isAdminMessage(message);
    if (!isAdmin) {
      await discordRequest("POST", `/channels/${channelId}/messages`, {
        content: `<@${message.author.id}> only admins/moderators can run /rules.`,
      });
      continue;
    }

    await ensureRulesMessage({ forceRepost: true, requestedById: message.author.id });

    if (String(channelId) !== String(RULES_CHANNEL_ID)) {
      await discordRequest("POST", `/channels/${channelId}/messages`, {
        content: `Rules were reposted in <#${RULES_CHANNEL_ID}>.`,
      });
    }
  }

  saveState();
}

async function handleRulesSlashInteraction(interaction) {
  const channelId = String(interaction && interaction.channel_id ? interaction.channel_id : "");
  const commandChannels = await resolveCommandChannels();

  if (channelId && commandChannels.length && !commandChannels.includes(channelId)) {
    await interactionCallback(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: "This command is not enabled in this channel.",
      },
    });
    return;
  }

  const isAdmin = await isAdminInteraction(interaction);
  if (!isAdmin) {
    await interactionCallback(interaction.id, interaction.token, {
      type: 4,
      data: {
        flags: 64,
        content: "Only admins/moderators can run /rules.",
      },
    });
    return;
  }

  const userId = interactionUserId(interaction);
  await ensureRulesMessage({ forceRepost: true, requestedById: userId });

  await interactionCallback(interaction.id, interaction.token, {
    type: 4,
    data: {
      flags: 64,
      content: `Rules were reposted in <#${RULES_CHANNEL_ID}>.`,
    },
  });
}

async function handleGatewayDispatch(eventType, eventData) {
  if (eventType !== "INTERACTION_CREATE") return;
  if (!eventData || eventData.type !== 2 || !eventData.data) return;
  if (String(eventData.data.name || "").toLowerCase() !== RULES_COMMAND_NAME) return;
  await handleRulesSlashInteraction(eventData);
}

const presence = startDiscordPresence({
  token: BOT_TOKEN,
  intents: 1,
  status: "online",
  logPrefix: "Palladium Community",
  activity: {
    name: "server rules",
    type: 3,
  },
  onReady: async () => {
    await upsertRulesCommand();
  },
  onDispatch: handleGatewayDispatch,
});

async function initialize() {
  await resolveGuildId();
  await resolveCommandChannels();
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
  await upsertRulesCommand();

  console.log(
    `Community bot ready as ${botUser && botUser.username ? botUser.username : "bot"} in guild ${GUILD_ID}` +
    (memberPollingEnabled ? "" : " (rules-only mode)")
  );
  console.log(`Community /rules command channels: ${COMMAND_CHANNEL_IDS.join(", ")}`);
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

      const commandChannels = await resolveCommandChannels();
      for (const channelId of commandChannels) {
        try {
          await pollCommandChannel(channelId);
        } catch (error) {
          const msg = error && error.message ? error.message : String(error);
          console.error(`Community command poll error in ${channelId}: ${msg}`);
        }
      }
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

initialize()
  .then(pollLoop)
  .catch((error) => {
    console.error(error && error.message ? error.message : String(error));
    shutdown(1);
  });

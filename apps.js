#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT_DIR = __dirname;
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "config", "palladium.env");
const DEFAULT_CONFIG_TEMPLATE_PATH = path.join(ROOT_DIR, "config", "palladium.env.example");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const BROWSER_FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_DISCORD_WIDGET_URL = "https://discord.com/api/guilds/1479914434460913707/widget.json";
const DEFAULT_DISCORD_INVITE_URL = "https://discord.gg/FNACSCcE26";

const STATIC_BLOCKED_ROOTS = new Set([
  ".git",
  ".github",
  ".vscode",
  "config",
  "discord-bots",
  "node_modules",
  "services"
]);

const STATIC_BLOCKED_TOP_LEVEL_FILES = new Set([
  ".discord-community-bot-state.json",
  "agents.md",
  "apps.js",
  "package-lock.json",
  "package.json",
  "readme.md",
  "start.sh"
]);

const PROVIDER_SIGNATURES = [
  {
    id: "securly",
    name: "Securly",
    blockedCategory: "Anonymous proxies",
    allowedCategory: "No signal from server-side probe",
    signatures: [/securly/i, /blocked by securly/i, /securly\.com\/blocked/i]
  },
  {
    id: "lightspeed",
    name: "Lightspeed",
    blockedCategory: "Web filtering policy",
    allowedCategory: "No signal from server-side probe",
    signatures: [/lightspeed/i, /relay\.lightspeedsystems\.com/i, /blocked by lightspeed/i]
  },
  {
    id: "goguardian",
    name: "GoGuardian",
    blockedCategory: "School admin policy",
    allowedCategory: "No signal from server-side probe",
    signatures: [/goguardian/i, /goguardian\.com/i, /blocked by school admin/i, /blocked by administrator/i]
  },
  {
    id: "palo_alto",
    name: "Palo Alto",
    blockedCategory: "URL filtering",
    allowedCategory: "No signal from server-side probe",
    signatures: [/palo alto/i, /url filtering/i, /urlfiltering\.paloaltonetworks\.com/i]
  },
  {
    id: "contentkeeper",
    name: "ContentKeeper",
    blockedCategory: "Web access policy",
    allowedCategory: "No signal from server-side probe",
    signatures: [/contentkeeper/i, /ckauth/i, /blocked by content keeper/i]
  },
  {
    id: "fortiguard",
    name: "FortiGuard",
    blockedCategory: "FortiGuard category filter",
    allowedCategory: "No signal from server-side probe",
    signatures: [/fortiguard/i, /fortinet/i, /fortigate/i]
  },
  {
    id: "blocksi",
    name: "Blocksi",
    blockedCategory: "School filtering policy",
    allowedCategory: "No signal from server-side probe",
    signatures: [/blocksi/i, /blocksi\.net/i]
  },
  {
    id: "linewize",
    name: "Linewize",
    blockedCategory: "Policy block",
    allowedCategory: "No signal from server-side probe",
    signatures: [/linewize/i, /familyzone/i]
  },
  {
    id: "cisco_talos",
    name: "Cisco Talos",
    blockedCategory: "Cisco Umbrella policy",
    allowedCategory: "No signal from server-side probe",
    signatures: [/cisco umbrella/i, /talos/i, /opendns/i]
  },
  {
    id: "aristotle",
    name: "Aristotle",
    blockedCategory: "K12 policy filter",
    allowedCategory: "No signal from server-side probe",
    signatures: [/aristotle/i, /aristotlek12/i]
  },
  {
    id: "lanschool",
    name: "LanSchool",
    blockedCategory: "Classroom restriction",
    allowedCategory: "No signal from server-side probe",
    signatures: [/lanschool/i, /lenovo classroom manager/i]
  },
  {
    id: "deledao",
    name: "Deledao",
    blockedCategory: "Education filter policy",
    allowedCategory: "No signal from server-side probe",
    signatures: [/deledao/i, /deledao education/i]
  }
];

const managed = {
  processes: [],
  httpServer: null,
  shuttingDown: false,
  runtime: {},
  runtimeStatus: {
    ollama: "disabled",
    discord: "disabled"
  }
};

main().catch((error) => {
  console.error("Fatal startup error:", error);
  shutdown(1);
});

async function main() {
  const configPath = process.env.PALLADIUM_CONFIG || process.env.BACKEND_CONFIG || DEFAULT_CONFIG_PATH;
  await ensureConfigExists(configPath);
  const fileEnv = await readEnvFile(configPath);
  const env = { ...fileEnv, ...process.env };

  const config = {
    rootDir: ROOT_DIR,
    configPath: path.resolve(configPath),
    host: readString(env, "SITE_HOST", "0.0.0.0"),
    port: readInt(env, "SITE_PORT", 443),
    corsOrigin: readString(env, "CORS_ORIGIN", "*"),
    frontendDir: resolvePath(readString(env, "FRONTEND_DIR", ".")),
    gamesDir: resolvePath(readString(env, "GAMES_DIR", "games")),
    requestTimeoutMs: readInt(env, "REQUEST_TIMEOUT_MS", 25_000),
    maxRequestBodyBytes: readInt(env, "MAX_REQUEST_BODY_BYTES", 131072),
    aiRequestTimeoutMs: readInt(env, "AI_REQUEST_TIMEOUT_MS", 120_000),
    monochromeBaseUrl: readString(env, "MONOCHROME_BASE_URL", "https://monochrome.tf"),
    proxyBaseUrl: readString(env, "PROXY_BASE_URL", ""),
    discordWidgetUrl: readString(env, "DISCORD_WIDGET_URL", DEFAULT_DISCORD_WIDGET_URL),
    discordInviteUrl: readString(env, "DISCORD_INVITE_URL", DEFAULT_DISCORD_INVITE_URL),

    ollamaBaseUrl: readString(env, "OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    ollamaModel: readString(env, "OLLAMA_MODEL", "qwen3.5:0.8b"),
    ollamaAutostart: readBool(env, "OLLAMA_AUTOSTART", true),
    ollamaCommand: readString(env, "OLLAMA_COMMAND", "ollama"),
    ollamaStartupTimeoutSeconds: readInt(env, "OLLAMA_STARTUP_TIMEOUT_SECONDS", 45),
    ollamaPullModelOnStart: readBool(env, "OLLAMA_PULL_MODEL_ON_START", true),
    ollamaPullTimeoutSeconds: readInt(env, "OLLAMA_PULL_TIMEOUT_SECONDS", 600),

    discordBotsAutostart: readBool(env, "DISCORD_BOTS_AUTOSTART", true),
    discordBotsDir: resolvePath(readString(env, "DISCORD_BOTS_DIR", "discord-bots")),
    discordBotsNodeCommand: readString(env, "DISCORD_BOTS_NODE_COMMAND", "node"),
    discordBotsStartupGraceSeconds: readInt(env, "DISCORD_BOTS_STARTUP_GRACE_SECONDS", 5),
    discordApiBase: readString(env, "DISCORD_API_BASE", "https://discord.com/api/v10"),
    discordGuildId: readString(env, "DISCORD_GUILD_ID", ""),
    discordRulesText: readString(env, "DISCORD_RULES_TEXT", ""),
    discordCommunityPollMs: readInt(env, "DISCORD_COMMUNITY_POLL_MS", 30_000),
    discordMemberSyncMs: readInt(env, "DISCORD_MEMBER_SYNC_MS", 120_000),
    discordRulesCheckMs: readInt(env, "DISCORD_RULES_CHECK_MS", 5 * 60 * 1000),
    discordRoleCacheMs: readInt(env, "DISCORD_ROLE_CACHE_MS", 10 * 60 * 1000),
    discordCommunityGatewayIntents: readInt(env, "DISCORD_COMMUNITY_GATEWAY_INTENTS", 1),
    discordModerationEnabled: readBool(env, "DISCORD_MODERATION_ENABLED", true),
    discordModerationTimeoutMinutes: readInt(env, "DISCORD_MODERATION_TIMEOUT_MINUTES", 15),
    discordModerationLookbackMs: readInt(env, "DISCORD_MODERATION_LOOKBACK_MS", 12_000),
    discordModerationMaxMessages: readInt(env, "DISCORD_MODERATION_MAX_MESSAGES", 6),
    discordModerationCooldownMs: readInt(env, "DISCORD_MODERATION_COOLDOWN_MS", 10 * 60 * 1000),
    discordModerationUseQwen: readBool(env, "DISCORD_MODERATION_USE_QWEN", true),
    discordModerationQwenTimeoutMs: readInt(env, "DISCORD_MODERATION_QWEN_TIMEOUT_MS", 8_000),
    discordModerationChannelIds: readString(env, "DISCORD_MODERATION_CHANNEL_IDS", ""),

    discordCommitBotToken: readString(env, "DISCORD_COMMIT_BOT_TOKEN", ""),
    discordLinkBotToken: readString(env, "DISCORD_LINK_BOT_TOKEN", ""),
    discordCommunityBotToken: readString(env, "DISCORD_COMMUNITY_BOT_TOKEN", ""),

    discordCommitChannelId: readString(env, "DISCORD_COMMIT_CHANNEL_ID", "1480022214303682700"),
    discordCommitRepo: readString(env, "DISCORD_COMMIT_REPO", ""),
    discordCommitBranch: readString(env, "DISCORD_COMMIT_BRANCH", ""),
    discordCommitPollMs: readInt(env, "DISCORD_COMMIT_POLL_MS", 15_000),
    discordCommitGithubToken: readString(env, "DISCORD_COMMIT_GITHUB_TOKEN", ""),
    discordLinkPollMs: readInt(env, "DISCORD_LINK_POLL_MS", 60_000),
    discordLinkCommandSyncMs: readInt(env, "DISCORD_LINK_COMMAND_SYNC_MS", 60 * 60 * 1000),
    discordLinkLegacyPollingEnabled: readBool(env, "DISCORD_LINK_LEGACY_POLLING_ENABLED", false),
    discordLinkCommandChannelIds: readString(env, "DISCORD_LINK_COMMAND_CHANNEL_IDS", "1480327216826155059,1480329637660983408"),
    discordWelcomeChannelId: readString(env, "DISCORD_WELCOME_CHANNEL_ID", "1480334877961355304"),
    discordRulesChannelId: readString(env, "DISCORD_RULES_CHANNEL_ID", "1480324913561862184")
  };

  validatePaths(config);

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    shutdown(1);
  });
  process.on("unhandledRejection", (error) => {
    console.error("Unhandled rejection:", error);
    shutdown(1);
  });

  await startOllamaIfNeeded(config);
  await startDiscordBotsIfNeeded(config);

  await startHttpServer(config);

  console.log("Palladium monolith running.");
  console.log(`Site:     http://${displayHost(config.host)}:${config.port}`);
  console.log(`Frontend: ${config.frontendDir}`);
  console.log(`Games:    ${config.gamesDir}`);
  console.log(`Config:   ${config.configPath}`);
  console.log(`Ollama:   ${managed.runtimeStatus.ollama}`);
  console.log(`Discord:  ${managed.runtimeStatus.discord}`);
}

function resolvePath(relativeOrAbsolute) {
  const candidate = path.resolve(ROOT_DIR, relativeOrAbsolute);
  return candidate;
}

function displayHost(host) {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function readForwardedHeader(value) {
  return String(value || "")
    .split(",")[0]
    .trim();
}

function requestOrigin(req) {
  const forwardedProto = readForwardedHeader(req.headers["x-forwarded-proto"]);
  let proto = forwardedProto || (req.socket && req.socket.encrypted ? "https" : "http");

  const forwardedHost = readForwardedHeader(req.headers["x-forwarded-host"]);
  let host = forwardedHost || String(req.headers.host || "").trim() || "localhost";

  // If a reverse proxy forwards localhost host headers, prefer browser Origin when available.
  const originHeader = readForwardedHeader(req.headers.origin);
  if (originHeader) {
    try {
      const parsedOrigin = new URL(originHeader);
      const hostNameOnly = String(host).split(":")[0].toLowerCase();
      const sameHost = parsedOrigin.hostname.toLowerCase() === hostNameOnly;
      const hostLooksLocal = isLocalHostname(hostNameOnly);
      if (sameHost || hostLooksLocal) {
        host = parsedOrigin.host;
        proto = parsedOrigin.protocol.replace(":", "") || proto;
      }
    } catch {
      // Ignore invalid origin header.
    }
  }

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return `http://${host || "localhost"}`;
  }
}

function readString(env, key, fallback) {
  const value = env[key];
  if (typeof value === "string" && value.trim() !== "") {
    return value.trim();
  }
  return fallback;
}

function readInt(env, key, fallback) {
  const value = Number.parseInt(String(env[key] ?? ""), 10);
  if (Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function readBool(env, key, fallback) {
  const raw = String(env[key] ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") return false;
  return fallback;
}

function validatePaths(config) {
  if (!fs.existsSync(config.frontendDir)) {
    throw new Error(`Frontend directory does not exist: ${config.frontendDir}`);
  }
  if (!fs.existsSync(config.gamesDir)) {
    throw new Error(`Games directory does not exist: ${config.gamesDir}`);
  }
}

async function ensureConfigExists(configPath) {
  const absolute = path.resolve(configPath);
  const parent = path.dirname(absolute);
  await fsp.mkdir(parent, { recursive: true });

  if (fs.existsSync(absolute)) {
    return;
  }

  if (!fs.existsSync(DEFAULT_CONFIG_TEMPLATE_PATH)) {
    throw new Error(`Missing config template: ${DEFAULT_CONFIG_TEMPLATE_PATH}`);
  }

  await fsp.copyFile(DEFAULT_CONFIG_TEMPLATE_PATH, absolute);
  console.log(`Created config file: ${absolute}`);
}

async function readEnvFile(configPath) {
  const absolute = path.resolve(configPath);
  const result = {};
  const content = await fsp.readFile(absolute, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

async function startOllamaIfNeeded(config) {
  if (!config.ollamaAutostart) {
    managed.runtimeStatus.ollama = "disabled";
    return;
  }

  const tagsUrl = normalizeUrl(`${config.ollamaBaseUrl.replace(/\/+$/, "")}/api/tags`);

  if (await isHttpOk(tagsUrl, 2500)) {
    managed.runtimeStatus.ollama = `external (${config.ollamaBaseUrl})`;
    if (config.ollamaPullModelOnStart) {
      await ensureOllamaModel(config, tagsUrl);
    }
    return;
  }

  const child = spawn(config.ollamaCommand, ["serve"], {
    cwd: config.rootDir,
    stdio: ["ignore", "inherit", "inherit"]
  });

  managed.processes.push({ name: "ollama", process: child });
  managed.runtimeStatus.ollama = "starting";

  await waitForHttp(tagsUrl, config.ollamaStartupTimeoutSeconds * 1000, "Ollama");

  if (config.ollamaPullModelOnStart) {
    await ensureOllamaModel(config, tagsUrl);
  }

  managed.runtimeStatus.ollama = `managed (${config.ollamaBaseUrl})`;
}

async function ensureOllamaModel(config, tagsUrl) {
  const targetModel = (config.ollamaModel || "").trim();
  if (!targetModel) return;

  try {
    const response = await fetch(tagsUrl, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const payload = await response.json().catch(() => ({}));
      const models = Array.isArray(payload?.models) ? payload.models : [];
      const found = models.some((entry) => {
        const name = String(entry?.name || "");
        return name === targetModel || name.startsWith(`${targetModel}:`) || targetModel.startsWith(`${name}:`);
      });
      if (found) {
        return;
      }
    }
  } catch {
    // Continue to pull attempt.
  }

  console.log(`Pulling Ollama model '${targetModel}'...`);
  await runCommandWithTimeout(
    config.ollamaCommand,
    ["pull", targetModel],
    { cwd: config.rootDir, timeoutSeconds: Math.max(30, config.ollamaPullTimeoutSeconds) },
    "Ollama model pull"
  );
}

async function startDiscordBotsIfNeeded(config) {
  if (!config.discordBotsAutostart) {
    managed.runtimeStatus.discord = "disabled";
    return;
  }

  await ensureDir(config.discordBotsDir);

  const scripts = {
    commit: path.join(config.discordBotsDir, "discord-commit-presence.js"),
    links: path.join(config.discordBotsDir, "discord-link-command-bot.js"),
    community: path.join(config.discordBotsDir, "discord-community-bot.js")
  };

  const missingScripts = Object.entries(scripts)
    .filter(([, scriptPath]) => !fs.existsSync(scriptPath))
    .map(([name]) => name);

  if (missingScripts.length > 0) {
    console.warn(`Discord bot scripts missing (${missingScripts.join(", ")}). Skipping bot autostart.`);
    managed.runtimeStatus.discord = "scripts missing";
    return;
  }

  const appsBase = `http://${displayHost(config.host)}:${config.port}`;
  const baseEnv = {
    DISCORD_API_BASE: config.discordApiBase,
    DISCORD_GUILD_ID: config.discordGuildId,
    DISCORD_RULES_TEXT: config.discordRulesText,
    DISCORD_COMMUNITY_POLL_MS: String(Math.max(5000, config.discordCommunityPollMs)),
    DISCORD_MEMBER_SYNC_MS: String(Math.max(5000, config.discordMemberSyncMs)),
    DISCORD_RULES_CHECK_MS: String(Math.max(60_000, config.discordRulesCheckMs)),
    DISCORD_ROLE_CACHE_MS: String(Math.max(60_000, config.discordRoleCacheMs)),
    DISCORD_COMMUNITY_GATEWAY_INTENTS: String(Math.max(0, config.discordCommunityGatewayIntents)),
    DISCORD_MODERATION_ENABLED: config.discordModerationEnabled ? "true" : "false",
    DISCORD_MODERATION_TIMEOUT_MINUTES: String(Math.max(1, config.discordModerationTimeoutMinutes)),
    DISCORD_MODERATION_LOOKBACK_MS: String(Math.max(1000, config.discordModerationLookbackMs)),
    DISCORD_MODERATION_MAX_MESSAGES: String(Math.max(2, config.discordModerationMaxMessages)),
    DISCORD_MODERATION_COOLDOWN_MS: String(Math.max(1000, config.discordModerationCooldownMs)),
    DISCORD_MODERATION_USE_QWEN: config.discordModerationUseQwen ? "true" : "false",
    DISCORD_MODERATION_QWEN_TIMEOUT_MS: String(Math.max(1000, config.discordModerationQwenTimeoutMs)),
    DISCORD_MODERATION_CHANNEL_IDS: config.discordModerationChannelIds,
    DISCORD_COMMIT_CHANNEL_ID: config.discordCommitChannelId,
    DISCORD_LINK_POLL_MS: String(Math.max(5000, config.discordLinkPollMs)),
    DISCORD_LINK_COMMAND_SYNC_MS: String(Math.max(60_000, config.discordLinkCommandSyncMs)),
    DISCORD_LINK_LEGACY_POLLING_ENABLED: config.discordLinkLegacyPollingEnabled ? "true" : "false",
    DISCORD_LINK_COMMAND_CHANNEL_IDS: config.discordLinkCommandChannelIds,
    DISCORD_WELCOME_CHANNEL_ID: config.discordWelcomeChannelId,
    DISCORD_RULES_CHANNEL_ID: config.discordRulesChannelId,
    OLLAMA_BASE_URL: config.ollamaBaseUrl,
    OLLAMA_MODEL: config.ollamaModel,
    PALLADIUM_APPS_URL: appsBase
  };

  let started = 0;

  if (config.discordCommitBotToken) {
    const commitBotEnv = {
      ...baseEnv,
      DISCORD_COMMIT_BOT_TOKEN: config.discordCommitBotToken,
      DISCORD_BOT_TOKEN: config.discordCommitBotToken,
      DISCORD_COMMIT_REPO: config.discordCommitRepo,
      DISCORD_COMMIT_BRANCH: config.discordCommitBranch,
      DISCORD_COMMIT_POLL_MS: String(config.discordCommitPollMs)
    };
    if (config.discordCommitGithubToken) {
      commitBotEnv.DISCORD_COMMIT_GITHUB_TOKEN = config.discordCommitGithubToken;
    }

    await spawnBot(
      config,
      "discord-commit-presence.js",
      commitBotEnv,
      "commit"
    );
    started += 1;
  }

  if (config.discordLinkBotToken) {
    await spawnBot(
      config,
      "discord-link-command-bot.js",
      {
        ...baseEnv,
        DISCORD_LINK_BOT_TOKEN: config.discordLinkBotToken,
        DISCORD_BOT_TOKEN: config.discordLinkBotToken
      },
      "links"
    );
    started += 1;
  }

  if (config.discordCommunityBotToken) {
    await spawnBot(
      config,
      "discord-community-bot.js",
      {
        ...baseEnv,
        DISCORD_COMMUNITY_BOT_TOKEN: config.discordCommunityBotToken,
        DISCORD_BOT_TOKEN: config.discordCommunityBotToken
      },
      "community"
    );
    started += 1;
  }

  if (started === 0) {
    managed.runtimeStatus.discord = "tokens missing";
  } else {
    managed.runtimeStatus.discord = `managed (${started} bot${started === 1 ? "" : "s"})`;
  }
}

function spawnBot(config, scriptName, extraEnv, botName) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.discordBotsNodeCommand, [scriptName], {
      cwd: config.discordBotsDir,
      stdio: ["ignore", "inherit", "inherit"],
      env: {
        ...process.env,
        ...extraEnv
      }
    });

    managed.processes.push({ name: `discord-${botName}`, process: child });

    const graceMs = Math.max(1000, config.discordBotsStartupGraceSeconds * 1000);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, graceMs);

    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(`Discord ${botName} bot exited during startup (code=${code}, signal=${signal || "none"}).`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const onError = (error) => {
      cleanup();
      reject(error);
    };

    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function startHttpServer(config) {
  const server = http.createServer(async (req, res) => {
    try {
      await routeRequest(req, res, config);
    } catch (error) {
      console.error("Request handling error:", error);
      sendJson(res, 500, { ok: false, error: "Internal server error" }, config);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });

  managed.httpServer = server;
}

async function routeRequest(req, res, config) {
  if (!req.url || !req.method) {
    sendJson(res, 400, { ok: false, error: "Invalid request" }, config);
    return;
  }

  const method = req.method.toUpperCase();
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (method === "OPTIONS") {
    sendOptions(res, config);
    return;
  }

  if (url.pathname === "/health") {
    sendJson(
      res,
      200,
      {
        ok: true,
        service: "palladium-monolith",
        time: new Date().toISOString(),
        runtime: managed.runtimeStatus,
        features: [
          "static-frontend",
          "api/games",
          "api/proxy/fetch",
          "api/ai/chat",
          "api/discord/widget",
          "link-check"
        ]
      },
      config
    );
    return;
  }

  if (url.pathname === "/api/proxy/health") {
    sendJson(res, 200, { ok: true, service: "proxy" }, config);
    return;
  }

  if (url.pathname === "/api/config/public") {
    const backendOrigin = requestOrigin(req);
    const configuredProxyBase = String(config.proxyBaseUrl || "").trim();
    let proxyBase = "";
    if (configuredProxyBase) {
      let candidate = configuredProxyBase;
      if (!/^https?:\/\//i.test(candidate)) {
        candidate = `https://${candidate}`;
      }
      try {
        proxyBase = new URL(candidate).origin;
      } catch {
        proxyBase = "";
      }
    }

    sendJson(
      res,
      200,
      {
        ok: true,
        backendBase: backendOrigin,
        services: {
          proxy: "/api/proxy/fetch",
          proxyFetch: "/api/proxy/fetch",
          proxyBase,
          aiChat: "/api/ai/chat",
          monochromeBase: config.monochromeBaseUrl,
          defaultAiModel: config.ollamaModel
        },
        discord: {
          commitBotConfigured: Boolean(config.discordCommitBotToken),
          linkBotConfigured: Boolean(config.discordLinkBotToken),
          communityBotConfigured: Boolean(config.discordCommunityBotToken),
          inviteUrl: config.discordInviteUrl,
          widgetUrl: config.discordWidgetUrl,
          commitChannelId: config.discordCommitChannelId,
          linkCommandChannelIds: config.discordLinkCommandChannelIds,
          welcomeChannelId: config.discordWelcomeChannelId,
          rulesChannelId: config.discordRulesChannelId
        }
      },
      config
    );
    return;
  }

  if (url.pathname === "/api/games" && (method === "GET" || method === "HEAD")) {
    const allGames = await loadGamesCatalog(config);
    const query = (url.searchParams.get("q") || "").trim().toLowerCase();
    const category = (url.searchParams.get("category") || "").trim().toLowerCase();

    const filtered = allGames.filter((entry) => {
      const categoryMatch = !category || category === "all" || entry.category.toLowerCase() === category;
      if (!categoryMatch) return false;
      if (!query) return true;
      return (
        entry.title.toLowerCase().includes(query) ||
        entry.author.toLowerCase().includes(query) ||
        entry.file.toLowerCase().includes(query) ||
        entry.category.toLowerCase().includes(query)
      );
    });

    const categories = countCategories(allGames);
    sendJson(
      res,
      200,
      {
        ok: true,
        count: filtered.length,
        total: allGames.length,
        categories,
        games: filtered
      },
      config,
      method === "HEAD"
    );
    return;
  }

  if (url.pathname === "/api/categories" && (method === "GET" || method === "HEAD")) {
    const categories = countCategories(await loadGamesCatalog(config));
    sendJson(res, 200, { ok: true, count: categories.length, categories }, config, method === "HEAD");
    return;
  }

  if (url.pathname === "/api/discord/widget" && (method === "GET" || method === "HEAD")) {
    const widgetUrl = normalizeUserUrl(config.discordWidgetUrl);
    if (!widgetUrl) {
      sendJson(res, 500, { ok: false, error: "Discord widget URL is not configured." }, config, method === "HEAD");
      return;
    }

    try {
      const upstream = await fetch(widgetUrl, {
        method: "GET",
        headers: {
          "user-agent": BROWSER_FETCH_USER_AGENT,
          accept: "application/json, text/plain;q=0.9, */*;q=0.8"
        },
        redirect: "follow",
        signal: AbortSignal.timeout(Math.max(5_000, Math.min(30_000, config.requestTimeoutMs)))
      });
      const bodyText = await upstream.text();
      const parsed = parseJsonObject(bodyText);

      if (!upstream.ok) {
        sendJson(
          res,
          upstream.status || 502,
          {
            ok: false,
            error: `Discord widget request failed (${upstream.status}).`,
            source: widgetUrl,
            inviteUrl: config.discordInviteUrl
          },
          config,
          method === "HEAD"
        );
        return;
      }

      if (!parsed || typeof parsed !== "object") {
        sendJson(
          res,
          502,
          {
            ok: false,
            error: "Discord widget returned invalid JSON.",
            source: widgetUrl,
            inviteUrl: config.discordInviteUrl
          },
          config,
          method === "HEAD"
        );
        return;
      }

      sendJson(
        res,
        200,
        {
          ok: true,
          source: widgetUrl,
          inviteUrl: config.discordInviteUrl,
          fetchedAt: new Date().toISOString(),
          widget: parsed
        },
        config,
        method === "HEAD"
      );
    } catch (error) {
      sendJson(
        res,
        502,
        {
          ok: false,
          error: String(error?.message || "Failed to fetch Discord widget."),
          source: widgetUrl,
          inviteUrl: config.discordInviteUrl
        },
        config,
        method === "HEAD"
      );
    }
    return;
  }

  if (url.pathname === "/api/proxy/fetch" && (method === "GET" || method === "HEAD")) {
    const target = normalizeUserUrl(url.searchParams.get("url") || "");
    if (!target) {
      sendText(res, 400, "Missing or invalid url parameter", config);
      return;
    }

    const upstreamMethod = method === "HEAD" ? "HEAD" : "GET";
    const requestHeaders = {
      "user-agent": BROWSER_FETCH_USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9"
    };

    let response = await fetch(target, {
      method: upstreamMethod,
      headers: requestHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });

    if (method === "HEAD" && [400, 403, 405, 501].includes(response.status)) {
      try {
        response = await fetch(target, {
          method: "GET",
          headers: requestHeaders,
          redirect: "follow",
          signal: AbortSignal.timeout(config.requestTimeoutMs)
        });
      } catch {
        // Keep the original HEAD response.
      }
    }

    if (method === "HEAD") {
      if (response.body && typeof response.body.cancel === "function") {
        try {
          await response.body.cancel();
        } catch {
          // Ignore cancellation issues.
        }
      }
      sendHeadFromUpstream(res, response, config);
      return;
    }

    const body = Buffer.from(await response.arrayBuffer());
    const headers = {
      "content-type": response.headers.get("content-type") || "application/octet-stream",
      "x-palladium-final-url": response.url || target
    };
    sendBinary(res, response.status, body, headers, config);
    return;
  }

  if (url.pathname === "/api/ai/chat" && method === "POST") {
    let body;
    try {
      body = await readRequestBody(req, config.maxRequestBodyBytes);
    } catch (error) {
      sendJson(res, 413, { ok: false, error: String(error?.message || "Request body too large") }, config);
      return;
    }
    const raw = body.toString("utf8").trim();
    if (!raw) {
      sendJson(res, 400, { ok: false, error: "Request body is required" }, config);
      return;
    }

    const parsed = parseJsonObject(raw);
    if (!parsed) {
      sendJson(res, 400, { ok: false, error: "Request body must be valid JSON." }, config);
      return;
    }

    const normalized = normalizeAiPayload(parsed, config.ollamaModel);
    const baseUrl = config.ollamaBaseUrl.replace(/\/+$/, "");
    const chatTimeoutMs = Math.min(config.aiRequestTimeoutMs, 10_000);
    const generateTimeoutMs = Math.min(config.aiRequestTimeoutMs, 18_000);

    if (normalized.stream) {
      await streamAiChat(req, res, config, normalized, `${baseUrl}/api/chat`, chatTimeoutMs);
      return;
    }

    // Try /api/chat first; if it times out or returns empty content, fall back to /api/generate.
    const chatAttempt = await postJsonWithTimeout(`${baseUrl}/api/chat`, normalized, chatTimeoutMs);
    const chatText = extractAssistantText(chatAttempt.data);
    if (chatAttempt.ok && chatText) {
      sendJson(res, 200, buildAssistantPayload(normalized.model, chatText, "chat"), config);
      return;
    }

    const generatePayload = buildGeneratePayload(normalized, config.ollamaModel);
    const generateAttempt = await postJsonWithTimeout(
      `${baseUrl}/api/generate`,
      generatePayload,
      generateTimeoutMs
    );
    const generatedText = extractAssistantText(generateAttempt.data);
    if (generateAttempt.ok && generatedText) {
      sendJson(res, 200, buildAssistantPayload(generatePayload.model, generatedText, "generate"), config);
      return;
    }

    const errorMessage =
      generateAttempt.error ||
      chatAttempt.error ||
      "AI upstream returned an empty response.";
    sendJson(
      res,
      502,
      {
        ok: false,
        error: errorMessage,
        details: {
          chatStatus: chatAttempt.status,
          generateStatus: generateAttempt.status
        }
      },
      config
    );
    return;
  }

  if (url.pathname === "/link-check" && (method === "GET" || method === "HEAD")) {
    const target = normalizeUserUrl(url.searchParams.get("url") || "");
    if (!target) {
      sendJson(res, 400, { ok: false, error: "Missing or invalid url parameter" }, config, method === "HEAD");
      return;
    }

    const result = await runLinkCheck(target, config.requestTimeoutMs);
    sendJson(res, 200, { ok: true, ...result }, config, method === "HEAD");
    return;
  }

  await serveStatic(req, res, config, url.pathname, method);
}

async function loadGamesCatalog(config) {
  const gamesHtmlPath = path.join(config.frontendDir, "games.html");
  if (fs.existsSync(gamesHtmlPath)) {
    const html = await fsp.readFile(gamesHtmlPath, "utf8");
    const cardRegex = /<a\s+href="([^"]*game-player\.html\?[^"]+)"[^>]*class="[^"]*game-card[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    const entries = [];
    const seen = new Set();

    for (const match of html.matchAll(cardRegex)) {
      const href = match[1] || "";
      const block = match[2] || "";
      const url = new URL(href, "http://localhost/");

      const gamePath = (url.searchParams.get("game") || "").trim();
      if (!gamePath) continue;

      const title = (url.searchParams.get("title") || path.basename(gamePath)).trim();
      const author = (url.searchParams.get("author") || "Unknown").trim();
      const imageMatch = block.match(/<img[^>]*src="([^"]+)"/i);
      const image = imageMatch ? imageMatch[1].trim() : "";
      const category = inferCategory(gamePath);
      const key = `${gamePath}::${title}`;

      if (seen.has(key)) continue;
      seen.add(key);

      entries.push({
        file: path.basename(gamePath),
        title,
        author,
        category,
        path: gamePath,
        image,
        playerPath: `game-player.html?game=${encodeURIComponent(gamePath)}&title=${encodeURIComponent(title)}&author=${encodeURIComponent(author)}`
      });
    }

    if (entries.length > 0) {
      return entries;
    }
  }

  const fallback = [];
  const files = await walkFiles(config.gamesDir);
  for (const absPath of files) {
    if (!absPath.endsWith(".html")) continue;
    const rel = normalizeSlash(path.relative(config.frontendDir, absPath));
    if (!rel.startsWith("games/")) continue;

    const title = humanizeFilename(path.basename(rel, ".html"));
    fallback.push({
      file: path.basename(rel),
      title,
      author: "Unknown",
      category: inferCategory(rel),
      path: rel,
      image: "",
      playerPath: `game-player.html?game=${encodeURIComponent(rel)}&title=${encodeURIComponent(title)}&author=${encodeURIComponent("Unknown")}`
    });
  }
  return fallback;
}

function countCategories(entries) {
  const map = new Map();
  for (const entry of entries) {
    const key = String(entry.category || "other").toLowerCase();
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([id, count]) => ({ id, count }));
}

function inferCategory(gamePath) {
  const normalized = normalizeSlash(gamePath);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0].toLowerCase() === "games") {
    return parts[1];
  }
  return "other";
}

function humanizeFilename(name) {
  return String(name || "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isTextLikeContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  if (!value) return true;
  if (value.includes("text/")) return true;
  if (value.includes("json")) return true;
  if (value.includes("xml")) return true;
  if (value.includes("javascript")) return true;
  if (value.includes("html")) return true;
  if (value.includes("svg")) return true;
  return false;
}

async function readResponseSnippet(response, maxChars = 220_000) {
  if (!response || !response.body) return "";

  const contentType = response.headers.get("content-type") || "";
  if (!isTextLikeContentType(contentType)) {
    if (typeof response.body.cancel === "function") {
      try {
        await response.body.cancel();
      } catch {
        // Ignore cancellation failures.
      }
    }
    return "";
  }

  if (typeof response.body.getReader !== "function") {
    try {
      const text = await response.text();
      return text.slice(0, maxChars);
    } catch {
      return "";
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    while (text.length < maxChars) {
      const chunk = await reader.read();
      if (!chunk || chunk.done) break;
      if (!chunk.value) continue;
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    // Best effort snippet reader.
  } finally {
    if (typeof reader.cancel === "function") {
      try {
        await reader.cancel();
      } catch {
        // Ignore cancellation failures.
      }
    }
  }

  return text.slice(0, maxChars);
}

async function runLinkCheck(targetUrl, timeoutMs) {
  const probeTimeoutMs = Math.max(4_000, Math.min(60_000, Number(timeoutMs) || 25_000));
  const requestHeaders = {
    "user-agent": BROWSER_FETCH_USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9"
  };

  const output = {
    url: targetUrl,
    checkedAt: new Date().toISOString(),
    scope: "server_network_only",
    probes: {
      direct: {
        reachable: false,
        ok: false,
        status: 0,
        finalUrl: targetUrl,
        error: ""
      }
    },
    providers: [],
    summary: {
      verdict: "unknown",
      text: "No provider data available.",
      passCount: 0,
      total: PROVIDER_SIGNATURES.length,
      scope: "server_network_only"
    }
  };

  let responseText = "";
  let responseHeaders = "";
  let finalUrl = targetUrl;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: requestHeaders,
      redirect: "follow",
      signal: AbortSignal.timeout(probeTimeoutMs)
    });

    output.probes.direct.reachable = true;
    output.probes.direct.ok = response.ok;
    output.probes.direct.status = response.status;
    output.probes.direct.finalUrl = response.url || targetUrl;
    finalUrl = output.probes.direct.finalUrl;

    responseHeaders = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    responseText = await readResponseSnippet(response);
  } catch (error) {
    output.probes.direct.error = String(error?.message || error);
  }

  if (!output.probes.direct.reachable) {
    try {
      const headResponse = await fetch(targetUrl, {
        method: "HEAD",
        headers: requestHeaders,
        redirect: "follow",
        signal: AbortSignal.timeout(Math.max(3_000, Math.floor(probeTimeoutMs * 0.6)))
      });

      output.probes.direct.reachable = true;
      output.probes.direct.ok = headResponse.ok;
      output.probes.direct.status = headResponse.status;
      output.probes.direct.finalUrl = headResponse.url || targetUrl;
      output.probes.direct.error = "";
      finalUrl = output.probes.direct.finalUrl;
      responseHeaders = [...headResponse.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    } catch {
      // Keep original GET error details.
    }
  }

  const haystack = `${responseText}\n${responseHeaders}\n${finalUrl}`;
  let passCount = 0;
  let blockedCount = 0;
  let unknownCount = 0;

  output.providers = PROVIDER_SIGNATURES.map((provider) => {
    if (!output.probes.direct.reachable) {
      unknownCount += 1;
      return {
        id: provider.id,
        name: provider.name,
        status: "unknown",
        category: "Probe unavailable",
        note: "Probe could not be completed"
      };
    }

    const matched = provider.signatures.find((signature) => signature.test(haystack));
    if (matched) {
      blockedCount += 1;
      return {
        id: provider.id,
        name: provider.name,
        status: "blocked",
        category: provider.blockedCategory || "Blocked by signature",
        note: `Matched signature: ${String(matched)}`
      };
    }

    unknownCount += 1;
    return {
      id: provider.id,
      name: provider.name,
      status: "unknown",
      category: provider.allowedCategory || "No signal from server-side probe",
      note: "No known block-page signature detected from the server-side probe"
    };
  });

  const total = output.providers.length;

  let verdict = "unknown";
  let headline = "Inconclusive";
  if (!output.probes.direct.reachable) {
    headline = "Inconclusive";
    verdict = "unknown";
  } else if (blockedCount === 0) {
    headline = "Inconclusive (Server-Side Only)";
    verdict = "inconclusive";
  } else if (blockedCount === total) {
    headline = "Likely Blocked";
    verdict = "likely_blocked";
  } else {
    headline = "Potentially Blocked";
    verdict = "partial";
  }

  let summaryText = "No provider data available.";
  if (!output.probes.direct.reachable) {
    summaryText = `${headline} • direct probe failed • provider checks unavailable`;
  } else if (blockedCount === 0) {
    summaryText = `${headline} • ${blockedCount} blocked signatures • ${unknownCount}/${total} no-signal`;
  } else if (blockedCount === total) {
    summaryText = `${headline} • ${blockedCount}/${total} blocked signatures`;
  } else {
    summaryText = `${headline} • ${blockedCount}/${total} blocked signatures • ${unknownCount}/${total} no-signal`;
  }

  output.summary = {
    verdict,
    text: summaryText,
    passCount,
    total,
    blockedCount,
    unknownCount,
    scope: "server_network_only"
  };

  return output;
}

async function serveStatic(req, res, config, pathname, method) {
  if (method !== "GET" && method !== "HEAD") {
    sendText(res, 405, "Method not allowed", config);
    return;
  }

  let cleaned = "";
  try {
    cleaned = decodeURIComponent(pathname);
  } catch {
    sendText(res, 400, "Bad request", config);
    return;
  }
  const relativePath = cleaned === "/" ? "index.html" : cleaned.replace(/^\/+/, "");
  if (isBlockedStaticPath(relativePath)) {
    sendText(res, 404, "Not found", config);
    return;
  }
  const absolutePath = path.resolve(config.frontendDir, relativePath);

  if (!isPathInside(config.frontendDir, absolutePath)) {
    sendText(res, 403, "Forbidden", config);
    return;
  }

  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch {
    sendText(res, 404, "Not found", config);
    return;
  }

  let filePath = absolutePath;
  if (stat.isDirectory()) {
    filePath = path.join(absolutePath, "index.html");
    try {
      stat = await fsp.stat(filePath);
    } catch {
      sendText(res, 404, "Not found", config);
      return;
    }
  }

  if (!stat.isFile()) {
    sendText(res, 404, "Not found", config);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  if (method === "HEAD") {
    sendHead(res, 200, {
      "content-type": contentType,
      "content-length": String(stat.size)
    }, config);
    return;
  }

  addCors(res, config);
  addSecurityHeaders(res);
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(stat.size)
  });

  const stream = fs.createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      sendText(res, 500, "Failed to read file", config);
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

function isBlockedStaticPath(relativePath) {
  const normalized = normalizeSlash(relativePath).replace(/^\/+/, "").toLowerCase();
  if (!normalized) return true;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) return true;
  if (segments.some((segment) => segment === "." || segment === "..")) return true;
  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (STATIC_BLOCKED_ROOTS.has(segments[0])) return true;
  if (segments.length === 1 && STATIC_BLOCKED_TOP_LEVEL_FILES.has(segments[0])) return true;
  return false;
}

function isPathInside(baseDir, candidatePath) {
  const relative = path.relative(baseDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function walkFiles(root) {
  const out = [];

  async function visit(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(full);
      } else if (entry.isFile()) {
        out.push(full);
      }
    }
  }

  await visit(root);
  return out;
}

function normalizeSlash(value) {
  return String(value || "").replace(/\\/g, "/");
}

function normalizeUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.toString();
  } catch {
    return value;
  }
}

function normalizeUserUrl(value) {
  let raw = String(value || "").trim();
  if (!raw) return "";
  if (!/^https?:\/\//i.test(raw)) {
    raw = `https://${raw}`;
  }

  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

async function isHttpOk(url, timeoutMs) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHttp(url, timeoutMs, name) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isHttpOk(url, 2000)) return;
    await sleep(300);
  }
  throw new Error(`${name} did not become healthy in ${Math.ceil(timeoutMs / 1000)}s (${url}).`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommandWithTimeout(command, args, options, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "inherit", "inherit"],
      env: process.env
    });

    const timeoutMs = Math.max(1000, options.timeoutSeconds * 1000);
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${label} timed out after ${options.timeoutSeconds}s.`));
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit code ${code}.`));
      }
    });
  });
}

function parseJsonObject(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonMaybe(rawText) {
  const trimmed = String(rawText || "").trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function normalizeAiPayload(payload, fallbackModel) {
  const normalized = payload && typeof payload === "object" ? { ...payload } : {};
  if (!normalized.model) {
    normalized.model = String(fallbackModel || "");
  }

  if (!Array.isArray(normalized.messages) || normalized.messages.length === 0) {
    const prompt = String(normalized.prompt || "").trim();
    if (prompt) {
      normalized.messages = [{ role: "user", content: prompt }];
    } else {
      normalized.messages = [];
    }
  }

  if (typeof normalized.stream !== "boolean") {
    normalized.stream = false;
  }

  const options = normalized.options && typeof normalized.options === "object"
    ? { ...normalized.options }
    : {};

  const numPredict = Number(options.num_predict);
  if (!Number.isFinite(numPredict) || numPredict <= 0) {
    options.num_predict = 96;
  }

  const numCtx = Number(options.num_ctx);
  if (!Number.isFinite(numCtx) || numCtx <= 0) {
    options.num_ctx = 1024;
  }

  const temperature = Number(options.temperature);
  if (!Number.isFinite(temperature) || temperature < 0) {
    options.temperature = 0.1;
  }

  normalized.options = options;

  const keepAlive = String(normalized.keep_alive || "").trim();
  if (!keepAlive) {
    normalized.keep_alive = "30m";
  }

  if (typeof normalized.think !== "boolean") {
    normalized.think = false;
  }

  return normalized;
}

function flattenContent(contentValue) {
  if (typeof contentValue === "string") {
    return contentValue.trim();
  }

  if (Array.isArray(contentValue)) {
    return contentValue
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item.text === "string") return item.text;
        if (item && typeof item.content === "string") return item.content;
        return "";
      })
      .join("")
      .trim();
  }

  if (contentValue && typeof contentValue === "object") {
    if (typeof contentValue.text === "string") return contentValue.text.trim();
    if (typeof contentValue.content === "string") return contentValue.content.trim();
  }

  return "";
}

function extractAssistantText(payload) {
  if (!payload || typeof payload !== "object") return "";

  if (payload.message && typeof payload.message === "object") {
    const messageText = flattenContent(payload.message.content);
    if (messageText) return messageText;
  }

  if (typeof payload.response === "string" && payload.response.trim()) {
    return payload.response.trim();
  }

  if (typeof payload.content === "string" && payload.content.trim()) {
    return payload.content.trim();
  }

  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    const first = payload.choices[0] || {};
    if (first.message && typeof first.message === "object") {
      const choiceText = flattenContent(first.message.content);
      if (choiceText) return choiceText;
    }
    if (typeof first.text === "string" && first.text.trim()) {
      return first.text.trim();
    }
  }

  return "";
}

function extractUpstreamError(payload, rawText, fallbackMessage) {
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim();
  }

  if (payload && payload.error && typeof payload.error === "object" && typeof payload.error.message === "string") {
    const nested = payload.error.message.trim();
    if (nested) return nested;
  }

  const text = String(rawText || "").trim();
  if (text) {
    return text.length > 700 ? `${text.slice(0, 699)}…` : text;
  }

  return String(fallbackMessage || "Unknown upstream error");
}

async function postJsonWithTimeout(targetUrl, payload, timeoutMs) {
  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify(payload || {}),
      signal: AbortSignal.timeout(Math.max(3000, timeoutMs))
    });

    const rawText = await response.text();
    const parsed = parseJsonMaybe(rawText);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        data: parsed,
        error: extractUpstreamError(parsed, rawText, `Upstream request failed (${response.status}).`)
      };
    }

    return {
      ok: true,
      status: response.status,
      data: parsed,
      error: ""
    };
  } catch (error) {
    const message = String(error?.message || error || "Unknown network error");
    const timeoutLike = /timeout/i.test(message);
    return {
      ok: false,
      status: 0,
      data: {},
      error: timeoutLike ? "AI upstream request timed out." : message
    };
  }
}

async function streamAiChat(req, res, config, payload, targetUrl, timeoutMs) {
  const controller = new AbortController();
  const safeTimeoutMs = Math.max(3000, Number(timeoutMs) || 10_000);
  const timeoutHandle = setTimeout(() => controller.abort(new Error("AI stream timed out.")), safeTimeoutMs);
  const onClientClose = () => controller.abort(new Error("Client disconnected."));
  req.once("close", onClientClose);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/x-ndjson,application/json,text/plain"
      },
      body: JSON.stringify({ ...(payload || {}), stream: true }),
      signal: controller.signal
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => "");
      const parsed = parseJsonMaybe(rawText);
      const errorText = extractUpstreamError(parsed, rawText, `Upstream stream request failed (${response.status}).`);
      sendJson(
        res,
        502,
        {
          ok: false,
          error: errorText,
          details: {
            chatStatus: response.status
          }
        },
        config
      );
      return;
    }

    addCors(res, config);
    addSecurityHeaders(res);
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no"
    });

    if (!response.body) {
      res.write(`${JSON.stringify({ ok: false, error: "AI upstream stream body is empty.", done: true })}\n`);
      res.end();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let gotContent = false;

    const extractChunkText = (parsed) => {
      if (!parsed || typeof parsed !== "object") return "";
      if (parsed.message && typeof parsed.message === "object") {
        if (typeof parsed.message.content === "string") return parsed.message.content;
        if (Array.isArray(parsed.message.content)) {
          return parsed.message.content
            .map((item) => {
              if (typeof item === "string") return item;
              if (item && typeof item.text === "string") return item.text;
              if (item && typeof item.content === "string") return item.content;
              return "";
            })
            .join("");
        }
      }
      if (typeof parsed.response === "string") return parsed.response;
      if (typeof parsed.content === "string") return parsed.content;
      if (typeof parsed.delta === "string") return parsed.delta;
      return "";
    };

    const writeDelta = (deltaText) => {
      const delta = String(deltaText || "");
      if (!delta) return;
      gotContent = true;
      res.write(`${JSON.stringify({ ok: true, delta, done: false })}\n`);
    };

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
        if (!line) continue;

        let parsed = null;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        if (parsed && typeof parsed.error === "string" && parsed.error.trim()) {
          throw new Error(parsed.error.trim());
        }

        if (parsed && typeof parsed.delta === "string") {
          writeDelta(parsed.delta);
        } else {
          writeDelta(extractChunkText(parsed));
        }

        if (parsed && parsed.done === true) {
          buffer = "";
          break;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const tail = JSON.parse(buffer.trim());
        if (tail && typeof tail.error === "string" && tail.error.trim()) {
          throw new Error(tail.error.trim());
        }
        if (tail && typeof tail.delta === "string") {
          writeDelta(tail.delta);
        } else {
          writeDelta(extractChunkText(tail));
        }
      } catch {
        // Ignore non-JSON tail chunks.
      }
    }

    if (!gotContent) {
      res.write(`${JSON.stringify({ ok: true, delta: "", done: false })}\n`);
    }
    res.write(
      `${JSON.stringify({ ok: true, done: true, source: "chat", model: String((payload && payload.model) || "") })}\n`
    );
    res.end();
  } catch (error) {
    const message = extractUpstreamError(null, String(error?.message || error || ""), "AI stream request failed.");
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, error: message }, config);
    } else {
      res.write(`${JSON.stringify({ ok: false, error: message, done: true })}\n`);
      res.end();
    }
  } finally {
    clearTimeout(timeoutHandle);
    req.off("close", onClientClose);
  }
}

function buildPromptFromMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return "User: Hello\n\nAssistant:";
  }

  const lines = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const roleRaw = String(message.role || "user").toLowerCase();
    const role =
      roleRaw === "system"
        ? "System"
        : roleRaw === "assistant"
          ? "Assistant"
          : roleRaw === "tool"
            ? "Tool"
            : "User";
    const content = flattenContent(message.content);
    if (!content) continue;
    lines.push(`${role}: ${content}`);
  }

  lines.push("Assistant:");
  return lines.join("\n\n");
}

function buildGeneratePayload(normalizedPayload, fallbackModel) {
  const payload = {
    model: String(normalizedPayload.model || fallbackModel || ""),
    stream: false,
    prompt: buildPromptFromMessages(normalizedPayload.messages)
  };

  if (normalizedPayload && typeof normalizedPayload.options === "object" && normalizedPayload.options) {
    payload.options = normalizedPayload.options;
  }

  if (typeof normalizedPayload.keep_alive !== "undefined") {
    payload.keep_alive = normalizedPayload.keep_alive;
  }
  if (typeof normalizedPayload.think === "boolean") {
    payload.think = normalizedPayload.think;
  }

  return payload;
}

function buildAssistantPayload(model, text, source) {
  return {
    ok: true,
    model: String(model || ""),
    message: {
      role: "assistant",
      content: String(text || "").trim()
    },
    done: true,
    source: source || "chat",
    created_at: new Date().toISOString()
  };
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Request body exceeds ${maxBytes} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function addCors(res, config) {
  res.setHeader("access-control-allow-origin", config.corsOrigin);
  res.setHeader("access-control-allow-methods", "GET,HEAD,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
}

function addSecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  res.setHeader("x-frame-options", "SAMEORIGIN");
}

function sendOptions(res, config) {
  addCors(res, config);
  res.writeHead(204);
  res.end();
}

function sendHead(res, status, headers, config) {
  addCors(res, config);
  addSecurityHeaders(res);
  res.writeHead(status, headers);
  res.end();
}

function sendHeadFromUpstream(res, response, config) {
  addCors(res, config);
  addSecurityHeaders(res);
  const headers = {
    "content-type": response.headers.get("content-type") || "application/octet-stream",
    "x-palladium-final-url": response.url || ""
  };
  res.writeHead(response.status, headers);
  res.end();
}

function sendText(res, status, message, config) {
  addCors(res, config);
  addSecurityHeaders(res);
  const body = Buffer.from(String(message || ""), "utf8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": String(body.length)
  });
  res.end(body);
}

function sendJson(res, status, payload, config, headOnly = false) {
  addCors(res, config);
  addSecurityHeaders(res);
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": String(body.length)
  });
  if (headOnly) {
    res.end();
    return;
  }
  res.end(body);
}

function sendBinary(res, status, body, headers, config) {
  addCors(res, config);
  addSecurityHeaders(res);
  const mergedHeaders = {
    ...headers,
    "content-length": String(body.length)
  };
  res.writeHead(status, mergedHeaders);
  res.end(body);
}

async function shutdown(exitCode) {
  if (managed.shuttingDown) {
    return;
  }
  managed.shuttingDown = true;

  if (managed.httpServer) {
    await new Promise((resolve) => managed.httpServer.close(resolve));
  }

  for (const entry of managed.processes.reverse()) {
    const child = entry.process;
    if (!child || child.killed) continue;
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }

  await sleep(400);

  for (const entry of managed.processes.reverse()) {
    const child = entry.process;
    if (!child || child.exitCode !== null || child.signalCode) continue;
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }

  process.exit(exitCode);
}

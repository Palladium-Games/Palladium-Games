#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const http = require("node:http");
const net = require("node:net");
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

const PROVIDER_SIGNATURES = [
  { id: "securly", name: "Securly", signatures: [/securly/i, /blocked by securly/i, /securly\.com\/blocked/i] },
  { id: "lightspeed", name: "Lightspeed", signatures: [/lightspeed/i, /relay\.lightspeedsystems\.com/i, /blocked by lightspeed/i] },
  { id: "goguardian", name: "GoGuardian", signatures: [/goguardian/i, /goguardian\.com/i, /blocked by administrator/i] },
  { id: "palo_alto", name: "Palo Alto", signatures: [/palo alto/i, /url filtering/i, /urlfiltering\.paloaltonetworks\.com/i] },
  { id: "contentkeeper", name: "ContentKeeper", signatures: [/contentkeeper/i, /ckauth/i, /blocked by content keeper/i] },
  { id: "fortiguard", name: "FortiGuard", signatures: [/fortiguard/i, /fortinet/i, /fortigate/i] },
  { id: "blocksi", name: "Blocksi", signatures: [/blocksi/i, /blocksi\.net/i] },
  { id: "linewize", name: "Linewize", signatures: [/linewize/i, /familyzone/i] },
  { id: "cisco_talos", name: "Cisco Talos", signatures: [/cisco umbrella/i, /talos/i, /opendns/i] },
  { id: "aristotle", name: "Aristotle", signatures: [/aristotle/i, /aristotlek12/i] },
  { id: "lanschool", name: "LanSchool", signatures: [/lanschool/i, /lenovo classroom manager/i] },
  { id: "deledao", name: "Deledao", signatures: [/deledao/i, /deledao education/i] }
];

const managed = {
  processes: [],
  httpServer: null,
  shuttingDown: false,
  runtime: {
    scramjetPort: null,
    scramjetBase: ""
  },
  runtimeStatus: {
    ollama: "disabled",
    scramjet: "disabled",
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
    port: readInt(env, "SITE_PORT", 3000),
    corsOrigin: readString(env, "CORS_ORIGIN", "*"),
    frontendDir: resolvePath(readString(env, "FRONTEND_DIR", "frontend")),
    gamesDir: resolvePath(readString(env, "GAMES_DIR", "frontend/games")),
    requestTimeoutMs: readInt(env, "REQUEST_TIMEOUT_MS", 25_000),
    maxRequestBodyBytes: readInt(env, "MAX_REQUEST_BODY_BYTES", 131072),
    aiRequestTimeoutMs: readInt(env, "AI_REQUEST_TIMEOUT_MS", 120_000),
    monochromeBaseUrl: readString(env, "MONOCHROME_BASE_URL", "https://monochrome.tf"),

    ollamaBaseUrl: readString(env, "OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
    ollamaModel: readString(env, "OLLAMA_MODEL", "qwen3.5:0.8b"),
    ollamaAutostart: readBool(env, "OLLAMA_AUTOSTART", true),
    ollamaCommand: readString(env, "OLLAMA_COMMAND", "ollama"),
    ollamaStartupTimeoutSeconds: readInt(env, "OLLAMA_STARTUP_TIMEOUT_SECONDS", 45),
    ollamaPullModelOnStart: readBool(env, "OLLAMA_PULL_MODEL_ON_START", true),
    ollamaPullTimeoutSeconds: readInt(env, "OLLAMA_PULL_TIMEOUT_SECONDS", 600),

    scramjetAutostart: readBool(env, "SCRAMJET_AUTOSTART", true),
    scramjetDir: resolvePath(readString(env, "SCRAMJET_DIR", "scramjet-service")),
    scramjetNodeCommand: readString(env, "SCRAMJET_NODE_COMMAND", "node"),
    scramjetNpmCommand: readString(env, "SCRAMJET_NPM_COMMAND", "npm"),
    scramjetHost: readString(env, "SCRAMJET_HOST", "0.0.0.0"),
    scramjetPort: readInt(env, "SCRAMJET_PORT", 1337),
    scramjetInstallDeps: readBool(env, "SCRAMJET_INSTALL_DEPS", true),
    scramjetInstallTimeoutSeconds: readInt(env, "SCRAMJET_INSTALL_TIMEOUT_SECONDS", 300),
    scramjetStartupTimeoutSeconds: readInt(env, "SCRAMJET_STARTUP_TIMEOUT_SECONDS", 20),

    discordBotsAutostart: readBool(env, "DISCORD_BOTS_AUTOSTART", true),
    discordBotsDir: resolvePath(readString(env, "DISCORD_BOTS_DIR", "discord-bots")),
    discordBotsNodeCommand: readString(env, "DISCORD_BOTS_NODE_COMMAND", "node"),
    discordBotsStartupGraceSeconds: readInt(env, "DISCORD_BOTS_STARTUP_GRACE_SECONDS", 5),
    discordApiBase: readString(env, "DISCORD_API_BASE", "https://discord.com/api/v10"),
    discordGuildId: readString(env, "DISCORD_GUILD_ID", ""),
    discordRulesText: readString(env, "DISCORD_RULES_TEXT", ""),

    discordCommitBotToken: readString(env, "DISCORD_COMMIT_BOT_TOKEN", ""),
    discordLinkBotToken: readString(env, "DISCORD_LINK_BOT_TOKEN", ""),
    discordCommunityBotToken: readString(env, "DISCORD_COMMUNITY_BOT_TOKEN", ""),

    discordCommitChannelId: readString(env, "DISCORD_COMMIT_CHANNEL_ID", "1480022214303682700"),
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
  await startScramjetIfNeeded(config);
  await startDiscordBotsIfNeeded(config);

  await startHttpServer(config);

  console.log("Palladium monolith running.");
  console.log(`Site:     http://${displayHost(config.host)}:${config.port}`);
  console.log(`Frontend: ${config.frontendDir}`);
  console.log(`Games:    ${config.gamesDir}`);
  console.log(`Config:   ${config.configPath}`);
  console.log(`Ollama:   ${managed.runtimeStatus.ollama}`);
  console.log(`Scramjet: ${managed.runtimeStatus.scramjet}`);
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
  const proto = forwardedProto || (req.socket && req.socket.encrypted ? "https" : "http");

  const forwardedHost = readForwardedHeader(req.headers["x-forwarded-host"]);
  const host = forwardedHost || String(req.headers.host || "").trim() || "localhost";

  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return `http://${host || "localhost"}`;
  }
}

function originWithPort(originValue, port) {
  try {
    const parsed = new URL(originValue);
    parsed.port = String(port);
    return parsed.origin;
  } catch {
    return originValue;
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

async function startScramjetIfNeeded(config) {
  if (!config.scramjetAutostart) {
    managed.runtimeStatus.scramjet = "disabled";
    return;
  }

  await ensureDir(config.scramjetDir);

  const preferredHost = displayHost(config.scramjetHost);
  const preferredPort = config.scramjetPort;
  const preferredBase = `http://${preferredHost}:${preferredPort}`;
  const preferredProbe = await probeScramjet(preferredBase, 2000);

  if (preferredProbe.healthOk && preferredProbe.uiOk) {
    managed.runtime.scramjetPort = preferredPort;
    managed.runtime.scramjetBase = preferredBase;
    managed.runtimeStatus.scramjet = `external (${preferredBase})`;
    return;
  }

  const entryPath = path.join(config.scramjetDir, "server.mjs");
  if (!fs.existsSync(entryPath)) {
    throw new Error(`Missing Scramjet entry script: ${entryPath}`);
  }

  let launchPort = preferredPort;
  if (preferredProbe.reachable) {
    launchPort = await findAvailablePort(config.scramjetHost, preferredPort + 1, 20);
    console.warn(
      `Scramjet port ${preferredPort} is occupied by an incompatible service. Launching managed Scramjet on ${launchPort}.`
    );
  }

  if (config.scramjetInstallDeps && !fs.existsSync(path.join(config.scramjetDir, "node_modules"))) {
    console.log("Installing Scramjet dependencies...");
    await runCommandWithTimeout(
      config.scramjetNpmCommand,
      ["install", "--omit=dev", "--no-audit"],
      { cwd: config.scramjetDir, timeoutSeconds: Math.max(10, config.scramjetInstallTimeoutSeconds) },
      "Scramjet dependency install"
    );
  }

  const child = spawn(config.scramjetNodeCommand, ["server.mjs"], {
    cwd: config.scramjetDir,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      SCRAMJET_HOST: config.scramjetHost,
      SCRAMJET_PORT: String(launchPort)
    }
  });

  managed.processes.push({ name: "scramjet", process: child });
  managed.runtimeStatus.scramjet = "starting";

  const launchBase = `http://${preferredHost}:${launchPort}`;
  const healthUrl = `${launchBase}/health`;
  await waitForHttp(healthUrl, config.scramjetStartupTimeoutSeconds * 1000, "Scramjet");

  const managedProbe = await probeScramjet(launchBase, 4000);
  if (!managedProbe.uiOk) {
    throw new Error(`Scramjet started on ${launchBase} but UI is not available at /.`);
  }

  managed.runtime.scramjetPort = launchPort;
  managed.runtime.scramjetBase = launchBase;
  managed.runtimeStatus.scramjet = `managed (${launchBase})`;
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
    DISCORD_COMMIT_CHANNEL_ID: config.discordCommitChannelId,
    DISCORD_LINK_COMMAND_CHANNEL_IDS: config.discordLinkCommandChannelIds,
    DISCORD_WELCOME_CHANNEL_ID: config.discordWelcomeChannelId,
    DISCORD_RULES_CHANNEL_ID: config.discordRulesChannelId,
    PALLADIUM_APPS_URL: appsBase
  };

  let started = 0;

  if (config.discordCommitBotToken) {
    await spawnBot(
      config,
      "discord-commit-presence.js",
      {
        ...baseEnv,
        DISCORD_COMMIT_BOT_TOKEN: config.discordCommitBotToken,
        DISCORD_BOT_TOKEN: config.discordCommitBotToken
      },
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
    const scramjetOrigin = managed.runtime.scramjetBase || originWithPort(backendOrigin, config.scramjetPort);

    sendJson(
      res,
      200,
      {
        ok: true,
        backendBase: backendOrigin,
        services: {
          proxy: "/api/proxy/fetch",
          proxyFetch: "/api/proxy/fetch",
          scramjetBase: scramjetOrigin,
          aiChat: "/api/ai/chat",
          monochromeBase: config.monochromeBaseUrl,
          defaultAiModel: config.ollamaModel
        },
        discord: {
          commitBotConfigured: Boolean(config.discordCommitBotToken),
          linkBotConfigured: Boolean(config.discordLinkBotToken),
          communityBotConfigured: Boolean(config.discordCommunityBotToken),
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

  if (url.pathname === "/api/proxy/fetch" && (method === "GET" || method === "HEAD")) {
    const target = normalizeUserUrl(url.searchParams.get("url") || "");
    if (!target) {
      sendText(res, 400, "Missing or invalid url parameter", config);
      return;
    }

    const response = await fetch(target, {
      method: "GET",
      headers: {
        "user-agent": "PalladiumMonolith/1.0"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });

    if (method === "HEAD") {
      sendHeadFromUpstream(res, response, config);
      return;
    }

    const body = Buffer.from(await response.arrayBuffer());
    const headers = {
      "content-type": response.headers.get("content-type") || "application/octet-stream"
    };
    sendBinary(res, response.status, body, headers, config);
    return;
  }

  if (url.pathname === "/api/ai/chat" && method === "POST") {
    let body;
    try {
      body = await readRequestBody(req, config.maxRequestBodyBytes);
    } catch (error) {
      sendText(res, 413, String(error?.message || "Request body too large"), config);
      return;
    }
    const raw = body.toString("utf8").trim();
    if (!raw) {
      sendText(res, 400, "Request body is required", config);
      return;
    }

    const payload = withDefaultModel(raw, config.ollamaModel);
    const target = `${config.ollamaBaseUrl.replace(/\/+$/, "")}/api/chat`;

    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: payload,
      signal: AbortSignal.timeout(config.aiRequestTimeoutMs)
    });

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";
    sendBinary(res, response.status, bytes, { "content-type": contentType }, config);
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

async function runLinkCheck(targetUrl, timeoutMs) {
  const output = {
    url: targetUrl,
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
      total: PROVIDER_SIGNATURES.length
    }
  };

  let responseText = "";
  let responseHeaders = "";
  let finalUrl = targetUrl;

  try {
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: { "user-agent": "PalladiumLinkChecker/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(Math.max(4000, timeoutMs))
    });

    output.probes.direct.reachable = true;
    output.probes.direct.ok = response.ok;
    output.probes.direct.status = response.status;
    output.probes.direct.finalUrl = response.url || targetUrl;
    finalUrl = output.probes.direct.finalUrl;

    responseHeaders = [...response.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
    responseText = await response.text();
  } catch (error) {
    output.probes.direct.error = String(error?.message || error);
  }

  const haystack = `${responseText}\n${responseHeaders}\n${finalUrl}`;
  let passCount = 0;
  let blockedCount = 0;

  output.providers = PROVIDER_SIGNATURES.map((provider) => {
    if (!output.probes.direct.reachable) {
      return {
        id: provider.id,
        name: provider.name,
        status: "unknown",
        note: "Probe could not be completed"
      };
    }

    const matched = provider.signatures.find((signature) => signature.test(haystack));
    if (matched) {
      blockedCount += 1;
      return {
        id: provider.id,
        name: provider.name,
        status: "detected",
        note: `Matched signature: ${String(matched)}`
      };
    }

    passCount += 1;
    return {
      id: provider.id,
      name: provider.name,
      status: "not_detected",
      note: "No known block-page signature detected"
    };
  });

  const total = output.providers.length;
  const clearPct = total > 0 ? Math.round((passCount / total) * 100) : 0;

  let verdict = "unknown";
  let headline = "Inconclusive";
  if (!output.probes.direct.reachable) {
    headline = "Inconclusive";
    verdict = "unknown";
  } else if (blockedCount === 0) {
    headline = "Likely Unblocked";
    verdict = "likely_unblocked";
  } else if (blockedCount === total) {
    headline = "Likely Blocked";
    verdict = "likely_blocked";
  } else {
    headline = "Partially Blocked";
    verdict = "partial";
  }

  output.summary = {
    verdict,
    text: `${headline} • ${clearPct}% clear • ${passCount}/${total} passed`,
    passCount,
    total
  };

  return output;
}

async function serveStatic(req, res, config, pathname, method) {
  if (method !== "GET" && method !== "HEAD") {
    sendText(res, 405, "Method not allowed", config);
    return;
  }

  const cleaned = decodeURIComponent(pathname);
  const relativePath = cleaned === "/" ? "index.html" : cleaned.replace(/^\/+/, "");
  const absolutePath = path.resolve(config.frontendDir, relativePath);

  if (!absolutePath.startsWith(config.frontendDir)) {
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

function withDefaultModel(rawJson, model) {
  if (rawJson.includes('"model"')) return rawJson;
  const trimmed = rawJson.trim();
  if (!trimmed.startsWith("{")) return rawJson;
  const safeModel = String(model || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `{"model":"${safeModel}",${trimmed.slice(1)}`;
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
    "content-type": response.headers.get("content-type") || "application/octet-stream"
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

async function probeScramjet(baseUrl, timeoutMs) {
  const result = {
    reachable: false,
    healthOk: false,
    uiOk: false
  };

  try {
    const healthResponse = await fetch(`${baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    result.reachable = true;
    result.healthOk = healthResponse.ok;
  } catch {
    // Ignore and continue probing.
  }

  try {
    const rootResponse = await fetch(`${baseUrl}/`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs)
    });
    result.reachable = true;
    const contentType = String(rootResponse.headers.get("content-type") || "").toLowerCase();
    result.uiOk = rootResponse.ok && contentType.includes("text/html");
  } catch {
    // Ignore root probe failures.
  }

  return result;
}

function canBindPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findAvailablePort(host, startPort, attempts) {
  for (let i = 0; i < attempts; i += 1) {
    const port = startPort + i;
    if (await canBindPort(host, port)) {
      return port;
    }
  }
  throw new Error(`No available port found for Scramjet after checking ${attempts} ports from ${startPort}.`);
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

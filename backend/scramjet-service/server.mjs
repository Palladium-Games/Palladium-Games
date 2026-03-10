import { Agent as HttpAgent, createServer } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createBareServer } from "@tomphttp/bare-server-node";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const HOST = process.env.SCRAMJET_HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.SCRAMJET_PORT || "1337", 10);
const BARE_PREFIX = "/bare/";
const KEEP_ALIVE_MAX_PER_IP = readPositiveInt(process.env.SCRAMJET_KEEPALIVE_MAX_PER_IP, 2000);
const KEEP_ALIVE_WINDOW_SECONDS = readPositiveInt(process.env.SCRAMJET_KEEPALIVE_WINDOW_SECONDS, 10);
const KEEP_ALIVE_BLOCK_SECONDS = readPositiveInt(process.env.SCRAMJET_KEEPALIVE_BLOCK_SECONDS, 2);
const OUTBOUND_MAX_SOCKETS = readPositiveInt(process.env.SCRAMJET_OUTBOUND_MAX_SOCKETS, 1024);
const OUTBOUND_MAX_FREE_SOCKETS = readPositiveInt(process.env.SCRAMJET_OUTBOUND_MAX_FREE_SOCKETS, 256);

const CLIENT_ROOT = resolve(__dirname, "client");
const SCRAM_ROOT = resolve(__dirname, "node_modules/@mercuryworkshop/scramjet/dist");
const BAREMUX_ROOT = resolve(__dirname, "node_modules/@mercuryworkshop/bare-mux/dist");
const BAREMOD_ROOT = resolve(__dirname, "node_modules/@mercuryworkshop/bare-as-module3/dist");
const EPOXY_ROOT = resolve(__dirname, "node_modules/@mercuryworkshop/epoxy-transport/dist");

const MIME_TYPES = {
  ".cjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

const httpAgent = new HttpAgent({
  keepAlive: true,
  maxSockets: OUTBOUND_MAX_SOCKETS,
  maxTotalSockets: OUTBOUND_MAX_SOCKETS,
  maxFreeSockets: OUTBOUND_MAX_FREE_SOCKETS
});

const httpsAgent = new HttpsAgent({
  keepAlive: true,
  maxSockets: OUTBOUND_MAX_SOCKETS,
  maxTotalSockets: OUTBOUND_MAX_SOCKETS,
  maxFreeSockets: OUTBOUND_MAX_FREE_SOCKETS
});

const bare = createBareServer(BARE_PREFIX, {
  blockLocal: false,
  logErrors: true,
  httpAgent,
  httpsAgent,
  connectionLimiter: {
    maxConnectionsPerIP: KEEP_ALIVE_MAX_PER_IP,
    windowDuration: KEEP_ALIVE_WINDOW_SECONDS,
    blockDuration: KEEP_ALIVE_BLOCK_SECONDS
  }
});

wisp.options.allow_loopback_ips = true;
wisp.options.allow_private_ips = true;

const server = createServer(async (req, res) => {
  setProxyHeaders(res);

  if (!req.url || !req.method) {
    sendJson(res, 400, { ok: false, error: "Invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    sendNoContent(res);
    return;
  }

  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
    return;
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "palladium-scramjet",
      transport: {
        bare: BARE_PREFIX,
        wisp: "/wisp/",
        baremod: "/baremod/index.mjs",
        baremux: "/baremux/index.mjs",
        epoxy: "/epoxy/index.js"
      },
      limits: {
        keepAliveMaxPerIp: KEEP_ALIVE_MAX_PER_IP,
        keepAliveWindowSeconds: KEEP_ALIVE_WINDOW_SECONDS,
        keepAliveBlockSeconds: KEEP_ALIVE_BLOCK_SECONDS,
        outboundMaxSockets: OUTBOUND_MAX_SOCKETS,
        outboundMaxFreeSockets: OUTBOUND_MAX_FREE_SOCKETS
      }
    });
    return;
  }

  if (requestUrl.pathname === "/api/meta") {
    await handleMetaRequest(requestUrl, res);
    return;
  }

  if (await tryServeStatic(req, res, requestUrl.pathname, "/scram/", SCRAM_ROOT, true)) {
    return;
  }

  if (
    await tryServeAlias(req, res, requestUrl.pathname, SCRAM_ROOT, {
      "/scramjet.all.js": "scramjet.all.js",
      "/scramjet.sync.js": "scramjet.sync.js",
      "/scramjet.wasm.wasm": "scramjet.wasm.wasm"
    })
  ) {
    return;
  }

  if (await tryServeStatic(req, res, requestUrl.pathname, "/baremux/", BAREMUX_ROOT, true)) {
    return;
  }

  if (await tryServeStatic(req, res, requestUrl.pathname, "/epoxy/", EPOXY_ROOT, true)) {
    return;
  }

  if (await tryServeStatic(req, res, requestUrl.pathname, "/baremod/", BAREMOD_ROOT, true)) {
    return;
  }

  if (await tryServeClient(req, res, requestUrl.pathname)) {
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
    return;
  }

  if (req.url?.startsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
    return;
  }

  socket.destroy();
});

server.listen(PORT, HOST, () => {
  const hostname = HOST === "0.0.0.0" ? "127.0.0.1" : HOST;
  console.log(`Palladium Scramjet running on http://${hostname}:${PORT}`);
  console.log("Routes: / (browser UI), /health, /bare/, /wisp/, /scram/, /baremux/, /baremod/, /epoxy/");
});

async function handleMetaRequest(requestUrl, res) {
  const input = requestUrl.searchParams.get("url") || "";

  let target;
  try {
    target = new URL(input);
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid URL" });
    return;
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    sendJson(res, 400, { ok: false, error: "Only http/https URLs are supported" });
    return;
  }

  try {
    const response = await fetch(target, {
      method: "GET",
      headers: {
        "User-Agent": "PalladiumScramjet/1.0"
      },
      signal: AbortSignal.timeout(12_000)
    });

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) {
      sendJson(res, 200, {
        ok: true,
        title: target.hostname,
        favicon: defaultFaviconFor(target),
        finalUrl: response.url || target.toString()
      });
      return;
    }

    const text = await response.text();
    const title = extractTitle(text) || target.hostname;
    const favicon = extractFavicon(text, response.url || target.toString()) || defaultFaviconFor(target);

    sendJson(res, 200, {
      ok: true,
      title,
      favicon,
      finalUrl: response.url || target.toString()
    });
  } catch (error) {
    sendJson(res, 200, {
      ok: true,
      title: target.hostname,
      favicon: defaultFaviconFor(target),
      finalUrl: target.toString(),
      warning: error instanceof Error ? error.message : "Failed to fetch site metadata"
    });
  }
}

async function tryServeClient(req, res, pathname) {
  if (pathname.startsWith("/api/") || pathname.startsWith(BARE_PREFIX) || pathname.startsWith("/wisp/")) {
    return false;
  }
  return tryServeStatic(req, res, pathname, "/", CLIENT_ROOT, false);
}

async function tryServeAlias(req, res, pathname, root, aliases) {
  const alias = aliases[pathname];
  if (!alias) {
    return false;
  }

  return tryServeStatic(req, res, `/${alias}`, "/", root, true);
}

async function tryServeStatic(req, res, pathname, prefix, root, immutable) {
  if (!pathname.startsWith(prefix)) {
    return false;
  }

  const relativeRaw = pathname === prefix ? "" : pathname.slice(prefix.length);
  const relativePath = decodeURIComponent(relativeRaw).replace(/^\/+/, "");
  const requested = relativePath || "index.html";

  const rootPath = resolve(root);
  const filePath = resolve(rootPath, requested);

  if (!isInsideRoot(rootPath, filePath)) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return true;
  }

  let finalPath = filePath;
  try {
    const fileStats = await stat(finalPath);
    if (fileStats.isDirectory()) {
      finalPath = resolve(finalPath, "index.html");
    }
  } catch {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return true;
  }

  try {
    const fileStats = await stat(finalPath);
    const contentType = MIME_TYPES[extname(finalPath).toLowerCase()] || "application/octet-stream";

    res.statusCode = 200;
    res.setHeader("content-type", contentType);
    res.setHeader("content-length", String(fileStats.size));

    if (immutable) {
      res.setHeader("cache-control", "public, max-age=86400, immutable");
    } else {
      res.setHeader("cache-control", "no-cache");
    }

    if (req.method === "HEAD") {
      res.end();
      return true;
    }

    createReadStream(finalPath).pipe(res);
    return true;
  } catch {
    sendJson(res, 404, { ok: false, error: "Not found" });
    return true;
  }
}

function isInsideRoot(root, candidate) {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(root + sep);
}

function setProxyHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function sendNoContent(res) {
  res.statusCode = 204;
  res.end();
}

function sendJson(res, statusCode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", String(body.length));
  res.end(body);
}

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }
  return cleanHtmlText(match[1]);
}

function extractFavicon(html, baseUrl) {
  const candidates = [];
  const linkMatches = html.match(/<link[^>]*>/gi) || [];

  for (const link of linkMatches) {
    const rel = extractAttribute(link, "rel").toLowerCase();
    if (!rel.includes("icon")) {
      continue;
    }
    const href = extractAttribute(link, "href");
    if (!href) {
      continue;
    }
    try {
      candidates.push(new URL(href, baseUrl).toString());
    } catch {
      // Ignore malformed icon URLs.
    }
  }

  if (candidates.length > 0) {
    return candidates[0];
  }

  try {
    return new URL("/favicon.ico", baseUrl).toString();
  } catch {
    return "";
  }
}

function extractAttribute(tag, attribute) {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`${escaped}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = tag.match(regex);
  return match ? match[2].trim() : "";
}

function cleanHtmlText(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function defaultFaviconFor(target) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(target.hostname)}&sz=64`;
}

function readPositiveInt(raw, fallback) {
  const parsed = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const { execSync } = require("child_process");

const PORT = Number(process.env.APPS_PORT || 1338);
const HOST = process.env.APPS_HOST || "0.0.0.0";
const LINKS_BOT_NAME = "Palladium Links";
const LINK_CHECK_BOT_NAME = "Palladium Link Checker";
const LINKS_CACHE_PATH = process.env.LINKS_CACHE_PATH || path.join(__dirname, ".palladium-links-seen.json");
const LINK_CHECK_TIMEOUT_MS = Number(process.env.LINK_CHECK_TIMEOUT_MS || 10000);
const LINK_CHECK_BODY_LIMIT = Number(process.env.LINK_CHECK_BODY_LIMIT || 220000);
const DISCORD_API_BASE = process.env.DISCORD_API_BASE || "https://discord.com/api/v10";

const FILTER_PROVIDERS = [
  {
    id: "goguardian",
    name: "GoGuardian",
    patterns: [/goguardian/i, /blocked by goguardian/i, /firewall\.goguardian\.com/i],
  },
  {
    id: "securly",
    name: "Securly",
    patterns: [/securly/i, /blocked by securly/i, /securly\.com\/blocked/i, /securly filter/i],
  },
  {
    id: "lightspeed",
    name: "Lightspeed",
    patterns: [/lightspeed systems/i, /lightspeedsystems\.com/i, /relay\.lightspeedsystems\.com/i, /lightspeed filter/i],
  },
  {
    id: "iboss",
    name: "iboss",
    patterns: [/iboss/i, /ibosscloud/i, /iboss filter/i],
  },
  {
    id: "umbrella",
    name: "Cisco Umbrella",
    patterns: [/cisco umbrella/i, /blocked by umbrella/i, /opendns/i, /policy\.umbrella\.com/i],
  },
  {
    id: "fortiguard",
    name: "FortiGuard",
    patterns: [/fortiguard/i, /fortinet/i, /web filter notification/i],
  },
  {
    id: "contentkeeper",
    name: "ContentKeeper",
    patterns: [/contentkeeper/i, /ckauth/i, /ck\/blocked/i],
  },
  {
    id: "linewize",
    name: "Linewize",
    patterns: [/linewize/i, /qoria/i, /family zone/i],
  },
];

const GENERIC_BLOCK_PATTERNS = [
  /website blocked/i,
  /this site is blocked/i,
  /access denied/i,
  /blocked by administrator/i,
  /request blocked/i,
  /content filter/i,
  /category blocked/i,
  /forbidden by policy/i,
  /cannot be accessed from this network/i,
  /you are not allowed to view this page/i,
];

const seenLinkOrigins = loadSeenLinkOrigins();

const LINKS_WEBHOOK_URL =
  process.env.DISCORD_LINKS_WEBHOOK_URL ||
  process.env.DISCORD_WEBHOOK_URL ||
  tryReadGitConfig("discord.linksWebhookUrl") ||
  tryReadGitConfig("discord.webhookUrl") ||
  "";

const LINK_CHECK_WEBHOOK_URL =
  process.env.DISCORD_LINK_CHECK_WEBHOOK_URL ||
  tryReadGitConfig("discord.linkCheckerWebhookUrl") ||
  "";

const DISCORD_BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN ||
  tryReadGitConfig("discord.botToken") ||
  "";

const LINKS_CHANNEL_ID =
  process.env.DISCORD_LINKS_CHANNEL_ID ||
  tryReadGitConfig("discord.linksChannelId") ||
  "";

const LINK_CHECK_CHANNEL_ID =
  process.env.DISCORD_LINK_CHECK_CHANNEL_ID ||
  tryReadGitConfig("discord.linkCheckerChannelId") ||
  "";

function tryReadGitConfig(key) {
  if (!key) return "";
  try {
    return execSync("git config --get " + key, {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function loadSeenLinkOrigins() {
  try {
    if (!fs.existsSync(LINKS_CACHE_PATH)) return new Set();
    const parsed = JSON.parse(fs.readFileSync(LINKS_CACHE_PATH, "utf8"));
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  } catch {
    return new Set();
  }
}

function persistSeenLinkOrigins() {
  try {
    const list = Array.from(seenLinkOrigins).sort();
    fs.writeFileSync(LINKS_CACHE_PATH, JSON.stringify(list, null, 2));
  } catch {
    // Non-fatal: in-memory dedupe still works while this process is running.
  }
}

function clampString(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  const max = Number.isFinite(maxChars) ? Math.max(16, Math.floor(maxChars)) : 280;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "x-palladium-apps": "1",
  });
  res.end(JSON.stringify(payload));
}

function safeResolveUrl(raw, base) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || value.startsWith("javascript:") || value.startsWith("data:")) return null;
  try {
    const resolved = new URL(value, base).href;
    if (!/^https?:\/\//i.test(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function normalizeLinkInput(rawUrl) {
  let value = String(rawUrl || "").trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;

  try {
    const url = new URL(value);
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseLinkCheckUrl(req, requestUrl) {
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return { error: "Use GET or POST for this endpoint." };
  }

  let rawUrl = requestUrl.searchParams.get("url") || "";

  if (method === "POST") {
    try {
      const body = await readBody(req);
      const payload = body.length ? JSON.parse(body.toString("utf8")) : {};
      if (payload && typeof payload.url === "string") rawUrl = payload.url;
    } catch {
      return { error: "Invalid JSON body" };
    }
  }

  const normalizedUrl = normalizeLinkInput(rawUrl);
  if (!normalizedUrl) {
    return { error: "Provide a valid http(s) URL in ?url= or JSON body." };
  }

  return { normalizedUrl };
}

function extractHtmlTitle(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return "";
  return clampString(
    match[1]
      .replace(/\s+/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
    160
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = LINK_CHECK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readTextPreview(response, maxBytes) {
  if (!response || !response.body || !Number.isFinite(maxBytes) || maxBytes <= 0) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.length) continue;

      const remaining = maxBytes - total;
      const slice = value.length > remaining ? value.subarray(0, remaining) : value;
      total += slice.length;
      chunks.push(Buffer.from(slice));

      if (total >= maxBytes) break;
    }
  } catch {
    // Ignore body read errors and return what we captured.
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Ignore cancellation errors.
    }
  }

  if (!chunks.length) return "";
  return Buffer.concat(chunks).toString("utf8");
}

function findProviderHits(text) {
  const haystack = String(text || "");
  const hits = [];
  for (const provider of FILTER_PROVIDERS) {
    if (provider.patterns.some((pattern) => pattern.test(haystack))) hits.push(provider.id);
  }
  return hits;
}

function collectGenericSignals(status, urlText, contentText) {
  const signals = [];

  if (status === 451) signals.push("HTTP 451 returned");
  if (status === 407) signals.push("Proxy authentication required (HTTP 407)");
  if (status === 403) signals.push("HTTP 403 returned");

  const combinedText = `${urlText || ""}\n${contentText || ""}`;
  for (const pattern of GENERIC_BLOCK_PATTERNS) {
    if (pattern.test(combinedText)) {
      signals.push(`Matched block phrase: ${pattern.source}`);
      break;
    }
  }

  if (/\/blocked|\/deny|\/access-denied|\/forbidden|filter\b/i.test(String(urlText || ""))) {
    signals.push("URL path resembles a block page");
  }

  return signals;
}

async function runDirectProbe(targetUrl) {
  const result = {
    mode: "direct",
    requestedUrl: targetUrl,
    fetchUrl: targetUrl,
    reachable: false,
    ok: false,
    status: null,
    finalUrl: "",
    contentType: "",
    title: "",
    providerDetections: [],
    genericSignals: [],
    error: "",
  };

  try {
    const response = await fetchWithTimeout(targetUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "user-agent": "Palladium-Link-Checker/1.0",
      },
    });

    result.reachable = true;
    result.ok = !!response.ok;
    result.status = response.status;
    result.finalUrl = clampString(response.url || targetUrl, 320);
    result.contentType = clampString(response.headers.get("content-type") || "", 180);

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    const isTextLike =
      contentType.includes("text/") ||
      contentType.includes("application/xhtml") ||
      contentType.includes("application/xml") ||
      contentType.includes("application/json");

    let bodyPreview = "";
    if (isTextLike) {
      bodyPreview = await readTextPreview(response, LINK_CHECK_BODY_LIMIT);
      result.title = extractHtmlTitle(bodyPreview);
    }

    const fingerprintText = `${result.finalUrl}\n${result.title}\n${bodyPreview}`;
    result.providerDetections = findProviderHits(fingerprintText);
    result.genericSignals = collectGenericSignals(result.status, result.finalUrl, bodyPreview);
  } catch (error) {
    result.error = clampString(error && error.message ? error.message : String(error), 240);
  }

  return result;
}

function summarizeLinkCheck(url, direct) {
  const directHitSet = new Set(direct.providerDetections || []);
  const directSignals = direct.genericSignals || [];

  const providerResults = FILTER_PROVIDERS.map((provider) => {
    const detected = directHitSet.has(provider.id);
    let status = "not_detected";
    let note = "No known block-page signature detected from direct network probe.";

    if (detected) {
      status = "detected";
      note = "Matched signature associated with this filtering provider.";
    } else if (!direct.reachable) {
      status = "unknown";
      note = "Direct probe could not be completed from this host/network.";
    }

    return {
      id: provider.id,
      name: provider.name,
      status,
      note,
    };
  });

  const detectedProviderNames = providerResults
    .filter((provider) => provider.status === "detected")
    .map((provider) => provider.name);

  let verdict = "unknown";
  let summaryText = "Could not determine blocker status reliably from this network.";

  if (detectedProviderNames.length > 0) {
    verdict = "likely_blocked";
    summaryText = `Possible school filter block page detected (${detectedProviderNames.join(", ")}).`;
  } else if (direct.reachable && direct.ok && directSignals.length === 0) {
    verdict = "likely_unblocked";
    summaryText = "No known school-filter signatures detected in direct network response.";
  } else if (direct.reachable) {
    verdict = "unknown";
    summaryText = "No specific provider matched, but warning signals or non-OK responses were found.";
  }

  return {
    ok: true,
    url,
    summary: {
      verdict,
      text: summaryText,
      detectedProviders: detectedProviderNames,
      warningSignals: directSignals.slice(0, 6),
      mode: "direct-only",
    },
    probes: {
      direct,
    },
    providers: providerResults,
    disclaimers: [
      "This is a best-effort signature/network check and is not an official API verdict from GoGuardian, Securly, or other vendors.",
      "Filter behavior varies by school policy, account, location, and time; results can change between networks.",
    ],
    checkedAt: new Date().toISOString(),
  };
}

async function runLinkCheck(normalizedUrl) {
  const directProbe = await runDirectProbe(normalizedUrl);
  return summarizeLinkCheck(normalizedUrl, directProbe);
}

function formatProbeStatus(probe) {
  if (!probe || !probe.reachable) {
    return `unreachable${probe && probe.error ? ` (${probe.error})` : ""}`;
  }
  const state = probe.ok ? "ok" : "not-ok";
  return `${state} (HTTP ${probe.status})`;
}

async function postWebhook(webhookUrl, payload) {
  if (!webhookUrl) return false;
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

function canUseBotChannel(channelId) {
  return !!(DISCORD_BOT_TOKEN && channelId);
}

async function postBotMessage(channelId, payload) {
  if (!canUseBotChannel(channelId)) return false;
  try {
    const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function sendLinkCheckNotification(result) {
  const verdict = result && result.summary ? result.summary.verdict : "unknown";
  const color =
    verdict === "likely_unblocked" ? 0x22c55e :
    verdict === "likely_blocked" ? 0xef4444 :
    0xf59e0b;

  const detectedProviders =
    result && result.summary && Array.isArray(result.summary.detectedProviders)
      ? result.summary.detectedProviders
      : [];

  const providerLines = (Array.isArray(result && result.providers) ? result.providers : [])
    .map((provider) => {
      const label = provider.status === "detected" ? "Detected" : provider.status === "not_detected" ? "Not detected" : "Unknown";
      return `${provider.name}: ${label}`;
    })
    .join("\n");

  const embed = {
    title: "Palladium Link Check",
    description: `[Open URL](${result.url})`,
    color,
    fields: [
      { name: "Verdict", value: clampString(result.summary.text || "Unknown", 900), inline: false },
      { name: "Detected Filters", value: detectedProviders.length ? clampString(detectedProviders.join(", "), 900) : "None detected", inline: false },
      { name: "Direct Probe", value: clampString(formatProbeStatus(result.probes.direct), 900), inline: false },
      { name: "Provider Snapshot", value: clampString(providerLines || "No provider rows.", 950), inline: false },
    ],
    footer: { text: "Palladium Link Checker (direct only)" },
    timestamp: result.checkedAt || new Date().toISOString(),
  };

  if (canUseBotChannel(LINK_CHECK_CHANNEL_ID)) {
    const sentViaBot = await postBotMessage(LINK_CHECK_CHANNEL_ID, { embeds: [embed] });
    if (sentViaBot) return true;
  }

  if (LINK_CHECK_WEBHOOK_URL) {
    return postWebhook(LINK_CHECK_WEBHOOK_URL, {
      username: LINK_CHECK_BOT_NAME,
      embeds: [embed],
    });
  }

  return false;
}

async function handleLinkCheck(req, res, requestUrl) {
  const parsed = await parseLinkCheckUrl(req, requestUrl);
  if (parsed.error) {
    sendJson(res, 400, { ok: false, error: parsed.error });
    return;
  }

  const result = await runLinkCheck(parsed.normalizedUrl);
  sendJson(res, 200, result);
}

async function handleLinkCheckDiscord(req, res, requestUrl) {
  const parsed = await parseLinkCheckUrl(req, requestUrl);
  if (parsed.error) {
    sendJson(res, 400, { ok: false, error: parsed.error });
    return;
  }

  const result = await runLinkCheck(parsed.normalizedUrl);
  const sent = await sendLinkCheckNotification(result);

  sendJson(res, 200, {
    ok: true,
    sent,
    webhookConfigured: !!LINK_CHECK_WEBHOOK_URL,
    botChannelConfigured: canUseBotChannel(LINK_CHECK_CHANNEL_ID),
    webhookName: LINK_CHECK_BOT_NAME,
    result,
  });
}

async function sendLinksNotification(originKey, sourcePage, referrer) {
  const embed = {
    title: "New Palladium Link",
    description: `[Open Link](${sourcePage})`,
    color: 0x22c55e,
    fields: [
      { name: "Origin", value: `\`${originKey}\``, inline: true },
      { name: "Page", value: `\`${sourcePage}\``, inline: false },
      { name: "Referrer", value: referrer ? clampString(referrer, 400) : "None", inline: false },
    ],
    footer: { text: "Palladium Links" },
    timestamp: new Date().toISOString(),
  };

  if (canUseBotChannel(LINKS_CHANNEL_ID)) {
    const sentViaBot = await postBotMessage(LINKS_CHANNEL_ID, {
      content: sourcePage,
      embeds: [embed],
    });
    if (sentViaBot) return true;
  }

  if (LINKS_WEBHOOK_URL) {
    return postWebhook(LINKS_WEBHOOK_URL, {
      username: LINKS_BOT_NAME,
      content: sourcePage,
      embeds: [embed],
    });
  }

  return false;
}

async function handleLinkSignal(req, res) {
  if ((req.method || "GET").toUpperCase() !== "POST") {
    sendJson(res, 405, { ok: false, error: "Use POST for /link-signal" });
    return;
  }

  const signalHeader = Array.isArray(req.headers["x-palladium-link-signal"])
    ? req.headers["x-palladium-link-signal"][0]
    : req.headers["x-palladium-link-signal"];
  if (String(signalHeader || "") !== "1") {
    sendJson(res, 400, { ok: false, error: "Missing x-palladium-link-signal header" });
    return;
  }

  let payload = {};
  try {
    const body = await readBody(req);
    payload = body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const rawHref = typeof payload.href === "string" ? payload.href : "";
  const rawOrigin = typeof payload.origin === "string" ? payload.origin : "";
  const sourcePage =
    safeResolveUrl(rawHref, rawOrigin || "https://example.com") ||
    safeResolveUrl(rawOrigin, "https://example.com");
  if (!sourcePage) {
    sendJson(res, 400, { ok: false, error: "Missing valid href/origin" });
    return;
  }

  let originKey = "";
  try {
    originKey = new URL(sourcePage).origin.toLowerCase();
  } catch {
    originKey = sourcePage;
  }

  if (seenLinkOrigins.has(originKey)) {
    sendJson(res, 200, { ok: true, duplicate: true, sent: false, origin: originKey });
    return;
  }

  seenLinkOrigins.add(originKey);
  persistSeenLinkOrigins();

  const referrer = typeof payload.referrer === "string" ? payload.referrer : "";
  const sent = await sendLinksNotification(originKey, sourcePage, referrer);

  sendJson(res, 200, {
    ok: true,
    duplicate: false,
    sent,
    origin: originKey,
    sourcePage,
    webhookConfigured: !!LINKS_WEBHOOK_URL,
    botChannelConfigured: canUseBotChannel(LINKS_CHANNEL_ID),
  });
}

function sendLanding(res) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Palladium Apps</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
      h1 { margin-top: 0; }
      code { background: #111827; padding: .2rem .4rem; border-radius: .35rem; }
      p { color: #94a3b8; }
    </style>
  </head>
  <body>
    <h1>Palladium Apps</h1>
    <p>Link signal endpoint: <code>/link-signal</code></p>
    <p>Link checker endpoint: <code>/link-check?url=https://example.com</code> (direct network only)</p>
    <p>Discord checker endpoint: <code>/link-check-discord?url=https://example.com</code></p>
    <p>Health check: <code>/health</code></p>
  </body>
</html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    const requestedHeaders = req.headers["access-control-request-headers"];
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-allow-headers": requestedHeaders || "*",
      "access-control-max-age": "86400",
      "x-palladium-apps": "1",
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "palladium-apps",
      linksWebhookConfigured: !!LINKS_WEBHOOK_URL,
      linkCheckerWebhookConfigured: !!LINK_CHECK_WEBHOOK_URL,
      botTokenConfigured: !!DISCORD_BOT_TOKEN,
      linksChannelConfigured: !!LINKS_CHANNEL_ID,
      linkCheckerChannelConfigured: !!LINK_CHECK_CHANNEL_ID,
      linkCheckerMode: "direct-only",
      linksTracked: seenLinkOrigins.size,
      linkCheckProviders: FILTER_PROVIDERS.length,
    });
    return;
  }

  if (requestUrl.pathname === "/link-check") {
    await handleLinkCheck(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/link-check-discord") {
    await handleLinkCheckDiscord(req, res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/link-signal") {
    await handleLinkSignal(req, res);
    return;
  }

  if (requestUrl.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestUrl.pathname === "/") {
    sendLanding(res);
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Palladium apps listening on http://localhost:${PORT}`);
});

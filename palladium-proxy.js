#!/usr/bin/env node

const http = require("http");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 1337);
const HOST = process.env.HOST || "0.0.0.0";
const PROXY_BASE = `http://localhost:${PORT}/proxy?url=`;
const PROXY_URL_PATTERN = /^https?:\/\/[^/]+\/proxy\?url=/i;

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const securityBlockedResponseHeaders = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "frame-options",
  "strict-transport-security",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

const rewriteOnlyBlockedHeaders = new Set([
  "content-length",
  "content-encoding",
  "etag",
  "content-md5",
]);

const cookieJar = new Map();

function proxyUrlFor(target) {
  return `${PROXY_BASE}${encodeURIComponent(target)}`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function safeResolveUrl(raw, base) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (
    !value ||
    value.startsWith("#") ||
    value.startsWith("data:") ||
    value.startsWith("blob:") ||
    value.startsWith("javascript:") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:")
  ) {
    return null;
  }
  try {
    const resolved = new URL(value, base).href;
    if (!/^https?:\/\//i.test(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function extractProxyTarget(rawUrl) {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(String(rawUrl));
    if ((parsed.pathname !== "/" && parsed.pathname !== "/proxy") || !parsed.searchParams.get("url")) {
      return null;
    }
    return safeResolveUrl(parsed.searchParams.get("url"), "https://example.com");
  } catch {
    return null;
  }
}

function rewriteSrcset(srcset, baseUrl) {
  return srcset
    .split(",")
    .map((part) => {
      const section = part.trim();
      if (!section) return section;
      const pieces = section.split(/\s+/);
      const rawUrl = pieces[0];
      const descriptor = pieces.slice(1).join(" ");
      const absolute = safeResolveUrl(rawUrl, baseUrl);
      if (!absolute) return section;
      return `${proxyUrlFor(absolute)}${descriptor ? ` ${descriptor}` : ""}`;
    })
    .join(", ");
}

function rewriteCss(content, baseUrl) {
  return content
    .replace(/url\(([^)]+)\)/gi, (full, inner) => {
      const raw = inner.trim().replace(/^["']|["']$/g, "");
      const absolute = safeResolveUrl(raw, baseUrl);
      if (!absolute) return full;
      return `url("${proxyUrlFor(absolute)}")`;
    })
    .replace(/@import\s+(url\()?["']([^"']+)["']/gi, (full, urlPrefix, raw) => {
      const absolute = safeResolveUrl(raw, baseUrl);
      if (!absolute) return full;
      if (urlPrefix) return `@import url("${proxyUrlFor(absolute)}")`;
      return `@import "${proxyUrlFor(absolute)}"`;
    });
}

function injectRuntime(html, currentTarget) {
  const runtime = `
<script>
(function () {
  var BASE = ${JSON.stringify(PROXY_BASE)};
  var CURRENT = ${JSON.stringify(currentTarget)};
  function parseProxyTarget(raw) {
    if (!raw) return "";
    try {
      var parsed = new URL(String(raw), window.location.href);
      if ((parsed.pathname === "/proxy" || parsed.pathname === "/") && parsed.searchParams.get("url")) {
        var target = new URL(parsed.searchParams.get("url"), CURRENT).href;
        return /^https?:\\/\\//i.test(target) ? target : "";
      }
      return "";
    } catch (_err) {
      return "";
    }
  }
  function currentTargetUrl() {
    return parseProxyTarget(window.location.href) || CURRENT;
  }
  function toAbsolute(input, baseUrl) {
    try {
      return new URL(String(input), baseUrl).href;
    } catch (_err) {
      return "";
    }
  }
  function proxify(input) {
    if (typeof input === "string" && /^\\/proxy\\?url=/i.test(input)) return input;
    try {
      var absolute = new URL(String(input), currentTargetUrl()).href;
      if (/^https?:\\/\\/[^/]+\\/proxy\\?url=/i.test(absolute)) return absolute;
      if (!/^https?:\\/\\//i.test(absolute)) return input;
      return BASE + encodeURIComponent(absolute);
    } catch (_err) {
      return input;
    }
  }
  function postMetadata() {
    var targetUrl = currentTargetUrl();
    var title = (document.title || "").trim();
    var iconNode = document.querySelector('link[rel~="icon"][href], link[rel="shortcut icon"][href], link[rel="apple-touch-icon"][href]');
    var iconHref = "";
    if (iconNode) {
      iconHref = toAbsolute(iconNode.getAttribute("href"), targetUrl);
    }
    if (!iconHref) {
      iconHref = toAbsolute("/favicon.ico", targetUrl);
    }
    var payload = {
      source: "palladium-proxy",
      type: "metadata",
      title: title || targetUrl,
      url: targetUrl,
      favicon: iconHref ? proxify(iconHref) : ""
    };
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, "*");
      }
    } catch (_err) {}
  }

  var metadataTimer = 0;
  function queueMetadata() {
    clearTimeout(metadataTimer);
    metadataTimer = setTimeout(postMetadata, 60);
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      if (typeof input === "string") {
        input = proxify(input);
      } else if (input instanceof Request) {
        var proxiedRequestUrl = proxify(input.url);
        if (proxiedRequestUrl !== input.url) {
          input = new Request(proxiedRequestUrl, input);
        }
      } else if (input && input.url) {
        input = proxify(input.url);
      }
      return origFetch.call(this, input, init);
    };
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    arguments[1] = proxify(url);
    return xhrOpen.apply(this, arguments);
  };

  var oldOpen = window.open;
  window.open = function (url, target, features) {
    if (!url) return oldOpen.call(window, url, target, features);
    return oldOpen.call(window, proxify(url), target, features);
  };

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download")) return;
    var href = anchor.getAttribute("href");
    if (!href || href[0] === "#" || /^javascript:/i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)) return;
    event.preventDefault();
    window.location.href = proxify(href);
    queueMetadata();
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM") return;
    if (form.target && form.target !== "_self") return;
    var action = form.getAttribute("action") || CURRENT;
    form.setAttribute("action", proxify(action));
    queueMetadata();
  }, true);

  var pushState = history.pushState;
  history.pushState = function () {
    var result = pushState.apply(this, arguments);
    queueMetadata();
    return result;
  };
  var replaceState = history.replaceState;
  history.replaceState = function () {
    var result = replaceState.apply(this, arguments);
    queueMetadata();
    return result;
  };

  document.addEventListener("DOMContentLoaded", queueMetadata, { once: true });
  window.addEventListener("load", queueMetadata);
  window.addEventListener("hashchange", queueMetadata);
  window.addEventListener("popstate", queueMetadata);

  if (window.MutationObserver) {
    var titleNode = document.querySelector("title");
    if (titleNode) {
      var observer = new MutationObserver(queueMetadata);
      observer.observe(titleNode, { childList: true, characterData: true, subtree: true });
    }
  }

  setInterval(queueMetadata, 1500);
  queueMetadata();
})();
</script>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${runtime}`);
  }
  return `${runtime}${html}`;
}

function rewriteHtml(html, baseUrl) {
  const inlineScriptBlocks = [];
  const withInlineScriptsProtected = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs) => {
      if (/\bsrc\s*=/i.test(attrs || "")) return full;
      const token = `__PALLADIUM_INLINE_SCRIPT_${inlineScriptBlocks.length}__`;
      inlineScriptBlocks.push(full);
      return token;
    }
  );

  let rewritten = withInlineScriptsProtected.replace(
    /\b(href|src|action|poster)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (full, attr, quoted, dbl, sgl, bare) => {
      const raw = dbl || sgl || bare || "";
      if (PROXY_URL_PATTERN.test(raw) || /^\/proxy\?url=/i.test(raw)) return full;
      const absolute = safeResolveUrl(raw, baseUrl);
      if (!absolute) return full;
      return `${attr}="${proxyUrlFor(absolute)}"`;
    }
  );

  rewritten = rewritten.replace(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)')/gi, (full, quoted, dbl, sgl) => {
    const raw = dbl || sgl || "";
    const next = rewriteSrcset(raw, baseUrl);
    return `srcset="${next}"`;
  });

  rewritten = rewritten.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (full, css) => {
    return full.replace(css, rewriteCss(css, baseUrl));
  });

  rewritten = rewritten.replace(/__PALLADIUM_INLINE_SCRIPT_(\d+)__/g, (full, idx) => {
    const value = inlineScriptBlocks[Number(idx)];
    return typeof value === "string" ? value : full;
  });

  return injectRuntime(rewritten, baseUrl);
}

function parseSetCookie(value) {
  const first = value.split(";")[0] || "";
  const equalsAt = first.indexOf("=");
  if (equalsAt <= 0) return null;
  return {
    name: first.slice(0, equalsAt).trim(),
    value: first.slice(equalsAt + 1).trim(),
  };
}

function storeCookies(origin, response) {
  if (typeof response.headers.getSetCookie !== "function") return;
  const values = response.headers.getSetCookie();
  if (!values || values.length === 0) return;
  if (!cookieJar.has(origin)) cookieJar.set(origin, new Map());
  const map = cookieJar.get(origin);
  for (const item of values) {
    const parsed = parseSetCookie(item);
    if (parsed) map.set(parsed.name, parsed.value);
  }
}

function buildCookieHeader(origin) {
  if (!cookieJar.has(origin)) return "";
  const map = cookieJar.get(origin);
  const entries = [];
  for (const [name, value] of map.entries()) {
    entries.push(`${name}=${value}`);
  }
  return entries.join("; ");
}

function buildRequestHeaders(req, targetUrl) {
  const headers = {};
  const target = new URL(targetUrl);

  for (const [name, value] of Object.entries(req.headers)) {
    if (!value) continue;
    const lower = name.toLowerCase();
    if (hopByHopHeaders.has(lower)) continue;
    if (["host", "origin", "referer", "content-length", "cookie"].includes(lower)) continue;
    headers[lower] = Array.isArray(value) ? value.join(", ") : value;
  }

  headers.host = target.host;

  const incomingReferer = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
  const refererTarget = extractProxyTarget(incomingReferer);
  if (refererTarget) {
    headers.referer = refererTarget;
    try {
      headers.origin = new URL(refererTarget).origin;
    } catch {
      headers.origin = target.origin;
    }
  } else {
    headers.origin = target.origin;
    headers.referer = `${target.origin}/`;
  }

  const cookieHeader = buildCookieHeader(target.origin);
  if (cookieHeader) headers.cookie = cookieHeader;

  return headers;
}

function buildResponseHeaders(upstream, target, rewriteBody) {
  const responseHeaders = {};

  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (securityBlockedResponseHeaders.has(lower)) return;
    if (hopByHopHeaders.has(lower)) return;
    if (rewriteBody && rewriteOnlyBlockedHeaders.has(lower)) return;
    if (lower === "location") {
      const rewritten = safeResolveUrl(value, target);
      if (rewritten) responseHeaders.location = proxyUrlFor(rewritten);
      return;
    }
    if (lower === "set-cookie") return;
    responseHeaders[lower] = value;
  });

  responseHeaders["access-control-allow-origin"] = "*";
  responseHeaders["access-control-allow-headers"] = "*";
  responseHeaders["access-control-allow-methods"] = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
  responseHeaders["timing-allow-origin"] = "*";
  responseHeaders["x-palladium-proxy"] = "1";

  if (rewriteBody) {
    delete responseHeaders["content-length"];
    delete responseHeaders["content-encoding"];
    delete responseHeaders["etag"];
  }

  if (typeof upstream.headers.getSetCookie === "function") {
    const values = upstream.headers.getSetCookie();
    if (values.length) {
      responseHeaders["set-cookie"] = values.map((cookie) =>
        cookie
          .replace(/;\s*Domain=[^;]+/gi, "")
          .replace(/;\s*Secure/gi, "")
      );
    }
  }

  return responseHeaders;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/gi, "/");
}

function stripHtmlTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSearchUrl(rawHref) {
  if (!rawHref) return "";
  const href = decodeHtmlEntities(String(rawHref).trim());
  try {
    const absolute = new URL(href, "https://duckduckgo.com");
    if (/duckduckgo\.com$/i.test(absolute.hostname) && absolute.pathname.startsWith("/l/")) {
      const target = absolute.searchParams.get("uddg");
      if (!target) return "";
      return safeResolveUrl(target, "https://example.com") || "";
    }
    if (/duckduckgo\.com$/i.test(absolute.hostname)) return "";
    return /^https?:$/.test(absolute.protocol) ? absolute.href : "";
  } catch {
    return "";
  }
}

function addUniqueResult(results, seen, item, limit) {
  if (!item || !item.url || !item.title) return;
  if (results.length >= limit) return;
  if (seen.has(item.url)) return;
  seen.add(item.url);
  results.push({
    title: item.title.trim(),
    url: item.url.trim(),
    snippet: (item.snippet || "").trim(),
  });
}

function collectRelatedTopics(topics, results, seen, limit) {
  if (!Array.isArray(topics)) return;
  for (const topic of topics) {
    if (results.length >= limit) return;
    if (!topic) continue;
    if (Array.isArray(topic.Topics)) {
      collectRelatedTopics(topic.Topics, results, seen, limit);
      continue;
    }
    const url = safeResolveUrl(topic.FirstURL, "https://example.com");
    if (!url) continue;
    addUniqueResult(
      results,
      seen,
      {
        title: topic.Text || url,
        url,
        snippet: "",
      },
      limit
    );
  }
}

async function fetchDuckDuckGoInstant(query, limit, results, seen) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return;
    const data = await response.json();

    if (data.AbstractURL && data.AbstractText) {
      const abstractUrl = safeResolveUrl(data.AbstractURL, "https://example.com");
      if (abstractUrl) {
        addUniqueResult(
          results,
          seen,
          {
            title: data.Heading || data.AbstractText.slice(0, 120),
            url: abstractUrl,
            snippet: data.AbstractText,
          },
          limit
        );
      }
    }

    collectRelatedTopics(data.RelatedTopics, results, seen, limit);
  } catch {
    // Keep graceful fallback behavior when search provider errors out.
  }
}

async function fetchDuckDuckGoHtml(query, limit, results, seen) {
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return;
    const html = await response.text();
    const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = anchorRe.exec(html)) !== null && results.length < limit) {
      const targetUrl = normalizeSearchUrl(match[1]);
      if (!targetUrl) continue;
      const title = stripHtmlTags(decodeHtmlEntities(match[2]));
      if (!title) continue;
      addUniqueResult(results, seen, { title, url: targetUrl, snippet: "" }, limit);
    }
  } catch {
    // Keep graceful fallback behavior when search provider errors out.
  }
}

async function fetchInternetSearchResults(query, limit) {
  const results = [];
  const seen = new Set();
  await fetchDuckDuckGoInstant(query, limit, results, seen);
  if (results.length < limit) {
    await fetchDuckDuckGoHtml(query, limit, results, seen);
  }
  return results.slice(0, limit);
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "x-palladium-proxy": "1",
  });
  res.end(JSON.stringify(payload));
}

async function handleAiSearch(res, requestUrl) {
  const query = (requestUrl.searchParams.get("q") || "").trim();
  const parsedLimit = Number(requestUrl.searchParams.get("limit") || 5);
  const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(10, Math.floor(parsedLimit))) : 5;

  if (!query) {
    sendJson(res, 400, { ok: false, error: "Missing query parameter: q", results: [] });
    return;
  }

  try {
    const results = await fetchInternetSearchResults(query, limit);
    sendJson(res, 200, {
      ok: true,
      query,
      provider: "duckduckgo",
      results,
    });
  } catch (error) {
    sendJson(res, 502, { ok: false, query, error: `Search failed: ${error.message}`, results: [] });
  }
}

function sendLanding(res) {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Palladium Proxy</title>
    <style>
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; background: #0f172a; color: #e2e8f0; }
      h1 { margin-top: 0; }
      form { display: flex; gap: .5rem; }
      input { flex: 1; padding: .75rem; border-radius: .5rem; border: 1px solid #334155; background: #111827; color: #e2e8f0; }
      button { padding: .75rem 1rem; border-radius: .5rem; border: 1px solid #334155; background: #2563eb; color: white; cursor: pointer; }
      p { color: #94a3b8; }
      code { background: #111827; padding: .2rem .4rem; border-radius: .35rem; }
    </style>
  </head>
  <body>
    <h1>Palladium Proxy</h1>
    <p>Enter a URL to browse through the local proxy.</p>
    <form method="GET" action="/proxy">
      <input name="url" placeholder="https://example.com" />
      <button type="submit">Open</button>
    </form>
    <p>Health check: <code>/health</code></p>
  </body>
</html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

async function handleProxy(req, res, requestUrl) {
  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) return sendLanding(res);

  const target = safeResolveUrl(rawTarget, "https://example.com");
  if (!target) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Invalid target URL");
    return;
  }

  const method = req.method || "GET";
  const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());
  const body = hasBody ? await readBody(req) : undefined;
  const headers = buildRequestHeaders(req, target);

  let upstream;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Proxy fetch failed: ${error.message}`);
    return;
  }

  storeCookies(new URL(target).origin, upstream);

  const contentType = upstream.headers.get("content-type") || "";
  const isHtml = /text\/html/i.test(contentType);
  const isCss = /text\/css/i.test(contentType);
  const rewriteBody = isHtml || isCss;
  const responseHeaders = buildResponseHeaders(upstream, target, rewriteBody);

  if (isHtml) {
    const html = await upstream.text();
    const rewritten = rewriteHtml(html, target);
    res.writeHead(upstream.status, responseHeaders);
    res.end(rewritten);
    return;
  }

  if (isCss) {
    const css = await upstream.text();
    const rewritten = rewriteCss(css, target);
    res.writeHead(upstream.status, responseHeaders);
    res.end(rewritten);
    return;
  }

  res.writeHead(upstream.status, responseHeaders);

  const upperMethod = method.toUpperCase();
  if (upperMethod === "HEAD" || !upstream.body || upstream.status === 204 || upstream.status === 304) {
    res.end();
    return;
  }

  try {
    await pipeline(Readable.fromWeb(upstream.body), res);
  } catch {
    if (!res.writableEnded) res.destroy();
  }
}

function extractRefererTarget(refererValue) {
  return extractProxyTarget(refererValue);
}

function resolveFallbackTarget(req, requestUrl) {
  const pathWithQuery = `${requestUrl.pathname}${requestUrl.search || ""}`;
  const refererHeader = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
  const refererTarget = extractRefererTarget(refererHeader);
  if (refererTarget) {
    const fromReferer = safeResolveUrl(pathWithQuery, refererTarget);
    if (fromReferer) return fromReferer;
  }

  const trimmedPath = requestUrl.pathname.replace(/^\/+/, "");
  if (!trimmedPath) return null;

  const pathAsUrl = safeResolveUrl(`${trimmedPath}${requestUrl.search || ""}`, "https://example.com");
  if (pathAsUrl) return pathAsUrl;

  return safeResolveUrl(`https://${trimmedPath}${requestUrl.search || ""}`, "https://example.com");
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
      "x-palladium-proxy": "1",
    });
    res.end();
    return;
  }

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (requestUrl.pathname === "/ai-search") {
    await handleAiSearch(res, requestUrl);
    return;
  }

  if (requestUrl.pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/proxy") {
    try {
      const hasTarget = requestUrl.searchParams.has("url");
      if (!hasTarget && requestUrl.pathname === "/") {
        sendLanding(res);
      } else {
        await handleProxy(req, res, requestUrl);
      }
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end(`Proxy error: ${error.message}`);
    }
    return;
  }

  const fallbackTarget = resolveFallbackTarget(req, requestUrl);
  if (!fallbackTarget) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("No proxied target could be inferred for this request.");
    return;
  }

  try {
    const proxyRequestUrl = new URL("/proxy", requestUrl.origin);
    proxyRequestUrl.searchParams.set("url", fallbackTarget);
    await handleProxy(req, res, proxyRequestUrl);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Proxy fallback error: ${error.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Palladium proxy listening on http://localhost:${PORT}/proxy`);
});

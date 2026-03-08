#!/usr/bin/env node

const http = require("http");
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

const blockedResponseHeaders = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "frame-options",
  "strict-transport-security",
  "permissions-policy",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "content-length",
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
  function proxify(input) {
    if (typeof input === "string" && /^\\/proxy\\?url=/i.test(input)) return input;
    try {
      var absolute = new URL(String(input), CURRENT).href;
      if (/^https?:\\/\\/[^/]+\\/proxy\\?url=/i.test(absolute)) return absolute;
      if (!/^https?:\\/\\//i.test(absolute)) return input;
      return BASE + encodeURIComponent(absolute);
    } catch (_err) {
      return input;
    }
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
    var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.getAttribute("href");
    if (!href || href[0] === "#" || /^javascript:/i.test(href) || /^mailto:/i.test(href) || /^tel:/i.test(href)) return;
    event.preventDefault();
    window.location.href = proxify(href);
  }, true);

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || form.tagName !== "FORM") return;
    var action = form.getAttribute("action") || CURRENT;
    form.setAttribute("action", proxify(action));
  }, true);
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
    if (["host", "origin", "referer", "content-length", "accept-encoding", "cookie"].includes(lower)) continue;
    headers[lower] = Array.isArray(value) ? value.join(", ") : value;
  }

  headers.host = target.host;
  headers.origin = target.origin;
  headers.referer = `${target.origin}/`;
  headers["accept-encoding"] = "identity";

  const cookieHeader = buildCookieHeader(target.origin);
  if (cookieHeader) headers.cookie = cookieHeader;

  return headers;
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

  const responseHeaders = {};
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (blockedResponseHeaders.has(lower)) return;
    if (hopByHopHeaders.has(lower)) return;
    if (lower === "location") {
      const rewritten = safeResolveUrl(value, target);
      if (rewritten) responseHeaders.location = proxyUrlFor(rewritten);
      return;
    }
    if (lower === "set-cookie") return;
    responseHeaders[lower] = value;
  });

  responseHeaders["access-control-allow-origin"] = "*";
  responseHeaders["x-palladium-proxy"] = "1";

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

  const contentType = upstream.headers.get("content-type") || "";
  if (/text\/html/i.test(contentType)) {
    const html = await upstream.text();
    const rewritten = rewriteHtml(html, target);
    res.writeHead(upstream.status, responseHeaders);
    res.end(rewritten);
    return;
  }

  if (/text\/css/i.test(contentType)) {
    const css = await upstream.text();
    const rewritten = rewriteCss(css, target);
    res.writeHead(upstream.status, responseHeaders);
    res.end(rewritten);
    return;
  }

  if (/javascript|json|text\//i.test(contentType)) {
    const text = await upstream.text();
    res.writeHead(upstream.status, responseHeaders);
    res.end(text);
    return;
  }

  const array = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, responseHeaders);
  res.end(array);
}

function extractRefererTarget(refererValue) {
  if (!refererValue) return null;
  try {
    const referer = new URL(String(refererValue));
    if (referer.pathname !== "/" && referer.pathname !== "/proxy") return null;
    return safeResolveUrl(referer.searchParams.get("url"), "https://example.com");
  } catch {
    return null;
  }
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

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true }));
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

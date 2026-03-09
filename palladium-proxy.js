#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { URL } = require("url");
const { execSync } = require("child_process");

const PORT = Number(process.env.PORT || 1337);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_PROXY_ORIGIN = (process.env.PUBLIC_PROXY_ORIGIN || "").replace(/\/+$/, "");
const PROXY_BASE = `${PUBLIC_PROXY_ORIGIN}/proxy?url=`;
const INTERNAL_PROXY_ORIGIN = process.env.INTERNAL_PROXY_ORIGIN || `http://127.0.0.1:${PORT}`;
const PROXY_URL_PATTERN = /^https?:\/\/[^/]+\/proxy\?(?:raw=1&)?url=/i;
const AI_FETCH_TIMEOUT_MS = Number(process.env.AI_FETCH_TIMEOUT_MS || 9000);
const AI_CONTEXT_MAX_RESULTS = Number(process.env.AI_CONTEXT_MAX_RESULTS || 4);
const AI_CONTEXT_MAX_CHARS = Number(process.env.AI_CONTEXT_MAX_CHARS || 360);
const AI_CONTEXT_CACHE_TTL_MS = Number(process.env.AI_CONTEXT_CACHE_TTL_MS || 3 * 60 * 1000);
const LINKS_BOT_NAME = "Palladium Links";
const LINKS_CACHE_PATH = process.env.LINKS_CACHE_PATH || path.join(__dirname, ".palladium-links-seen.json");

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
const aiContextCache = new Map();
const seenLinkOrigins = loadSeenLinkOrigins();
const LINKS_WEBHOOK_URL =
  process.env.DISCORD_LINKS_WEBHOOK_URL ||
  process.env.DISCORD_WEBHOOK_URL ||
  tryReadGitConfig("discord.linksWebhookUrl") ||
  tryReadGitConfig("discord.webhookUrl") ||
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
    // Non-fatal: in-memory dedupe still works while process is running.
  }
}

function proxyUrlFor(target) {
  return `${PROXY_BASE}${encodeURIComponent(target)}`;
}

function rawProxyUrlFor(target) {
  return `${PUBLIC_PROXY_ORIGIN}/proxy?raw=1&url=${encodeURIComponent(target)}`;
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
    const parsed = new URL(String(rawUrl), INTERNAL_PROXY_ORIGIN);
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
  var URL_ATTRS = { href: 1, src: 1, action: 1, formaction: 1, poster: 1, data: 1 };
  var PROXY_PREFIX_RE = /^https?:\\/\\/[^/]+\\/(?:proxy)?\\?(?:raw=1&)?url=/i;
  function shouldSkipValue(value) {
    var v = String(value || "").trim();
    return !v || v.charAt(0) === "#" || /^javascript:/i.test(v) || /^mailto:/i.test(v) || /^tel:/i.test(v);
  }
  function proxifyAttrValue(attrName, value, baseUrl) {
    if (!value || !URL_ATTRS[String(attrName || "").toLowerCase()]) return value;
    if (shouldSkipValue(value)) return value;
    if (PROXY_PREFIX_RE.test(String(value))) return value;
    try {
      var absolute = new URL(String(value), baseUrl || currentTargetUrl()).href;
      if (!/^https?:\\/\\//i.test(absolute)) return value;
      return BASE + encodeURIComponent(absolute);
    } catch (_err) {
      return value;
    }
  }
  function patchUrlProperty(proto, propertyName) {
    if (!proto || !propertyName) return;
    var descriptor = Object.getOwnPropertyDescriptor(proto, propertyName);
    if (!descriptor || !descriptor.get || !descriptor.set || descriptor.configurable === false) return;
    try {
      Object.defineProperty(proto, propertyName, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function () {
          return descriptor.get.call(this);
        },
        set: function (value) {
          var next = proxifyAttrValue(propertyName, value, currentTargetUrl());
          return descriptor.set.call(this, next);
        }
      });
    } catch (_err) {}
  }
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
      if (PROXY_PREFIX_RE.test(absolute)) return absolute;
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

  if (navigator && navigator.sendBeacon) {
    var oldSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      return oldSendBeacon(proxify(url), data);
    };
  }

  if (window.EventSource) {
    var NativeEventSource = window.EventSource;
    window.EventSource = function (url, config) {
      return new NativeEventSource(proxify(url), config);
    };
    window.EventSource.prototype = NativeEventSource.prototype;
  }

  if (window.Worker) {
    var NativeWorker = window.Worker;
    window.Worker = function (url, options) {
      return new NativeWorker(proxify(url), options);
    };
    window.Worker.prototype = NativeWorker.prototype;
  }

  if (window.SharedWorker) {
    var NativeSharedWorker = window.SharedWorker;
    window.SharedWorker = function (url, options) {
      return new NativeSharedWorker(proxify(url), options);
    };
    window.SharedWorker.prototype = NativeSharedWorker.prototype;
  }

  if (navigator && navigator.serviceWorker && navigator.serviceWorker.register) {
    var oldRegister = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = function (scriptURL, options) {
      return oldRegister(proxify(scriptURL), options);
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

  var oldAssign = window.location.assign ? window.location.assign.bind(window.location) : null;
  if (oldAssign) {
    window.location.assign = function (url) {
      return oldAssign(proxify(url));
    };
  }

  var oldReplace = window.location.replace ? window.location.replace.bind(window.location) : null;
  if (oldReplace) {
    window.location.replace = function (url) {
      return oldReplace(proxify(url));
    };
  }

  var oldSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    var attr = String(name || "").toLowerCase();
    if (URL_ATTRS[attr]) {
      value = proxifyAttrValue(attr, value, currentTargetUrl());
    }
    return oldSetAttribute.call(this, name, value);
  };

  patchUrlProperty(window.HTMLAnchorElement && window.HTMLAnchorElement.prototype, "href");
  patchUrlProperty(window.HTMLLinkElement && window.HTMLLinkElement.prototype, "href");
  patchUrlProperty(window.HTMLScriptElement && window.HTMLScriptElement.prototype, "src");
  patchUrlProperty(window.HTMLImageElement && window.HTMLImageElement.prototype, "src");
  patchUrlProperty(window.HTMLIFrameElement && window.HTMLIFrameElement.prototype, "src");
  patchUrlProperty(window.HTMLMediaElement && window.HTMLMediaElement.prototype, "src");
  patchUrlProperty(window.HTMLSourceElement && window.HTMLSourceElement.prototype, "src");
  patchUrlProperty(window.HTMLTrackElement && window.HTMLTrackElement.prototype, "src");
  patchUrlProperty(window.HTMLFormElement && window.HTMLFormElement.prototype, "action");
  patchUrlProperty(window.HTMLObjectElement && window.HTMLObjectElement.prototype, "data");

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

    var targetAttr = (form.getAttribute("target") || "").trim().toLowerCase();
    if (targetAttr && targetAttr !== "_self" && targetAttr !== "_top") return;

    var rawMethod = String(form.getAttribute("method") || form.method || "GET").toUpperCase();
    var rawAction = (form.getAttribute("action") || "").trim();
    var baseAction = rawAction || currentTargetUrl();

    if (rawMethod === "GET") {
      event.preventDefault();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();

      var absoluteAction;
      try {
        absoluteAction = new URL(baseAction, currentTargetUrl());
      } catch (_err) {
        absoluteAction = new URL(currentTargetUrl());
      }

      var params = new URLSearchParams(absoluteAction.search || "");
      try {
        var formData = new FormData(form);
        formData.forEach(function (value, key) {
          if (value == null) return;
          if (typeof value === "string") {
            params.append(key, value);
          } else if (value && value.name) {
            params.append(key, value.name);
          }
        });
      } catch (_ignored) {}

      absoluteAction.search = params.toString();
      absoluteAction.hash = "";
      window.location.href = proxify(absoluteAction.href);
      queueMetadata();
      return;
    }

    form.setAttribute("action", proxify(baseAction));
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

    var urlObserver = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var mutation = mutations[i];
        if (mutation.type === "attributes" && mutation.attributeName) {
          var attr = String(mutation.attributeName).toLowerCase();
          if (URL_ATTRS[attr]) {
            var node = mutation.target;
            var raw = node.getAttribute(attr);
            var next = proxifyAttrValue(attr, raw, currentTargetUrl());
            if (next && next !== raw) node.setAttribute(attr, next);
          }
        }

        if (mutation.type === "childList") {
          var added = mutation.addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var nodeItem = added[j];
            if (!nodeItem || nodeItem.nodeType !== 1 || !nodeItem.querySelectorAll) continue;
            var elements = [nodeItem].concat(Array.prototype.slice.call(nodeItem.querySelectorAll("[href],[src],[action],[formaction],[poster],[data]")));
            for (var k = 0; k < elements.length; k++) {
              var el = elements[k];
              for (var name in URL_ATTRS) {
                if (!Object.prototype.hasOwnProperty.call(URL_ATTRS, name)) continue;
                var rawValue = el.getAttribute && el.getAttribute(name);
                if (!rawValue) continue;
                var nextValue = proxifyAttrValue(name, rawValue, currentTargetUrl());
                if (nextValue && nextValue !== rawValue) el.setAttribute(name, nextValue);
              }
            }
          }
        }
      }
    });

    urlObserver.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["href", "src", "action", "formaction", "poster", "data"]
    });
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
    /\b(href|src|action|poster|formaction|data)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (full, attr, quoted, dbl, sgl, bare) => {
      const raw = dbl || sgl || bare || "";
      if (PROXY_URL_PATTERN.test(raw) || /^\/proxy\?url=/i.test(raw)) return full;
      const absolute = safeResolveUrl(raw, baseUrl);
      if (!absolute) return full;
      return `${attr}="${proxyUrlFor(absolute)}"`;
    }
  );

  rewritten = rewritten.replace(
    /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'])([^"']+)(["'][^>]*>)/gi,
    (full, prefix, contentValue, suffix) => {
      const nextContent = String(contentValue).replace(
        /(url\s*=\s*)([^;]+)/i,
        (segment, urlPrefix, rawUrl) => {
          const absolute = safeResolveUrl(rawUrl.trim(), baseUrl);
          if (!absolute) return segment;
          return `${urlPrefix}${proxyUrlFor(absolute)}`;
        }
      );
      return `${prefix}${nextContent}${suffix}`;
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

function buildResponseHeaders(upstream, target, rewriteBody, rawMode) {
  const responseHeaders = {};

  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (securityBlockedResponseHeaders.has(lower)) return;
    if (hopByHopHeaders.has(lower)) return;
    if (rewriteBody && rewriteOnlyBlockedHeaders.has(lower)) return;
    if (lower === "location") {
      const rewritten = safeResolveUrl(value, target);
      if (rewritten) responseHeaders.location = rawMode ? rawProxyUrlFor(rewritten) : proxyUrlFor(rewritten);
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

function trimSnippet(value, maxChars) {
  const limit = Number.isFinite(maxChars) ? Math.max(80, Math.floor(maxChars)) : AI_CONTEXT_MAX_CHARS;
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function getCachedAiContext(url) {
  const item = aiContextCache.get(url);
  if (!item) return null;
  if (Date.now() - item.ts > AI_CONTEXT_CACHE_TTL_MS) {
    aiContextCache.delete(url);
    return null;
  }
  return item.value || null;
}

function setCachedAiContext(url, value) {
  if (!url || !value) return;
  aiContextCache.set(url, { ts: Date.now(), value });
}

function extractTitleFromHtml(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match || !match[1]) return "";
  return trimSnippet(stripHtmlTags(decodeHtmlEntities(match[1])), 140);
}

function extractSnippetFromHtml(html) {
  const cleaned = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ");
  const text = decodeHtmlEntities(stripHtmlTags(cleaned));
  return trimSnippet(text, AI_CONTEXT_MAX_CHARS);
}

async function fetchThroughProxy(targetUrl, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : AI_FETCH_TIMEOUT_MS;
  const proxyRequestUrl = new URL("/proxy", INTERNAL_PROXY_ORIGIN);
  proxyRequestUrl.searchParams.set("raw", "1");
  proxyRequestUrl.searchParams.set("url", targetUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = { "x-palladium-ai": "1" };
    if (options.accept) headers.accept = options.accept;
    return await fetch(proxyRequestUrl, {
      method: "GET",
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchResultContextViaProxy(result) {
  if (!result || !result.url) return;
  const targetUrl = extractProxyTarget(result.url) || result.url;
  const cached = getCachedAiContext(targetUrl);
  if (cached) {
    if (!result.title && cached.title) result.title = cached.title;
    if (!result.snippet && cached.snippet) result.snippet = cached.snippet;
    return;
  }

  try {
    const response = await fetchThroughProxy(targetUrl, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      timeoutMs: AI_FETCH_TIMEOUT_MS,
    });
    if (!response.ok) return;
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return;
    const html = await response.text();
    const title = extractTitleFromHtml(html);
    const snippet = extractSnippetFromHtml(html);
    const context = {
      title: title || "",
      snippet: snippet || "",
    };
    setCachedAiContext(targetUrl, context);

    if ((!result.title || result.title === result.url) && context.title) {
      result.title = context.title;
    }
    if ((!result.snippet || result.snippet.length < 80) && context.snippet) {
      result.snippet = context.snippet;
    }
  } catch {
    // Graceful fallback: keep search result without page context.
  }
}

function normalizeSearchUrl(rawHref) {
  if (!rawHref) return "";
  let href = decodeHtmlEntities(String(rawHref).trim());
  const proxied = extractProxyTarget(safeResolveUrl(href, INTERNAL_PROXY_ORIGIN));
  if (proxied) href = proxied;
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
    const response = await fetchThroughProxy(url, {
      accept: "application/json,text/plain,*/*",
      timeoutMs: AI_FETCH_TIMEOUT_MS,
    });
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
    const response = await fetchThroughProxy(url, {
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      timeoutMs: AI_FETCH_TIMEOUT_MS,
    });
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
  const sliced = results.slice(0, limit);
  const enrichCount = Math.min(sliced.length, AI_CONTEXT_MAX_RESULTS);
  await Promise.all(
    sliced.slice(0, enrichCount).map(async (result) => {
      await fetchResultContextViaProxy(result);
    })
  );
  return sliced;
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

async function sendLinksWebhook(originKey, sourcePage, referrer, userAgent) {
  if (!LINKS_WEBHOOK_URL) return false;

  try {
    const payload = {
      username: LINKS_BOT_NAME,
      content: sourcePage,
      embeds: [
        {
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
        },
      ],
    };

    const response = await fetch(LINKS_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    return response.ok || response.status === 204;
  } catch (_err) {
    return false;
  }
}

function clampString(value, maxChars) {
  const text = String(value || "").trim();
  if (!text) return "";
  const max = Number.isFinite(maxChars) ? Math.max(16, Math.floor(maxChars)) : 280;
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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
  const userAgent = Array.isArray(req.headers["user-agent"])
    ? req.headers["user-agent"].join(" ")
    : req.headers["user-agent"] || "";
  const sent = await sendLinksWebhook(originKey, sourcePage, referrer, userAgent);

  sendJson(res, 200, {
    ok: true,
    duplicate: false,
    sent,
    origin: originKey,
    sourcePage,
    webhookConfigured: !!LINKS_WEBHOOK_URL,
    userAgent: clampString(userAgent, 180),
  });
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
      provider: "duckduckgo-via-proxy",
      routedViaProxy: true,
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
  let rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) {
    const refererHeader = Array.isArray(req.headers.referer) ? req.headers.referer[0] : req.headers.referer;
    const refererTarget = extractRefererTarget(refererHeader);
    const hasSearchQuery = requestUrl.searchParams.has("q");
    if (requestUrl.pathname === "/proxy" && hasSearchQuery) {
      try {
        const fallbackOrigin = refererTarget ? new URL(refererTarget).origin : "https://www.google.com";
        const recovered = new URL("/search", fallbackOrigin);
        requestUrl.searchParams.forEach((value, key) => {
          if (key === "url" || key === "raw") return;
          recovered.searchParams.append(key, value);
        });
        rawTarget = recovered.href;
      } catch {
        // Fall through to landing page behavior below.
      }
    }
  }
  if (!rawTarget) return sendLanding(res);
  const rawMode = requestUrl.searchParams.get("raw") === "1";

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
  const rewriteBody = !rawMode && (isHtml || isCss);
  const responseHeaders = buildResponseHeaders(upstream, target, rewriteBody, rawMode);

  if (isHtml && !rawMode) {
    const html = await upstream.text();
    const rewritten = rewriteHtml(html, target);
    res.writeHead(upstream.status, responseHeaders);
    res.end(rewritten);
    return;
  }

  if (isCss && !rawMode) {
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
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
      "x-palladium-proxy": "1",
    });
    res.end(JSON.stringify({ ok: true, linksWebhookConfigured: !!LINKS_WEBHOOK_URL, linksTracked: seenLinkOrigins.size }));
    return;
  }

  if (requestUrl.pathname === "/ai-search") {
    await handleAiSearch(res, requestUrl);
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
  const advertisedOrigin = PUBLIC_PROXY_ORIGIN || `http://localhost:${PORT}`;
  console.log(`Palladium proxy listening on ${HOST}:${PORT} (browse at ${advertisedOrigin}/proxy)`);
});

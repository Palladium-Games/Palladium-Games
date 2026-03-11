(function () {
  var TITLE_KEY = "palladium.site.title";
  var FAVICON_KEY = "palladium.site.favicon";
  var DEFAULT_TITLE = "Palladium Games";
  var DEFAULT_FAVICON = "images/favicon.png?v=3";

  function safeGetStorage(key) {
    try {
      return String(localStorage.getItem(key) || "").trim();
    } catch (error) {
      return "";
    }
  }

  function safeSetStorage(key, value) {
    try {
      if (String(value || "").trim()) {
        localStorage.setItem(key, String(value).trim());
      } else {
        localStorage.removeItem(key);
      }
    } catch (error) {
      // Ignore storage write failures.
    }
  }

  function normalizeFavicon(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    if (/^(data:image\/|https?:\/\/|\/|\.{1,2}\/)/i.test(raw)) return raw;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(raw)) return "https://" + raw;
    return raw;
  }

  function getSettings() {
    return {
      title: safeGetStorage(TITLE_KEY),
      favicon: normalizeFavicon(safeGetStorage(FAVICON_KEY))
    };
  }

  function decorateTitle(originalTitle) {
    var source = String(originalTitle || "").trim();
    var customTitle = getSettings().title;
    if (!customTitle) return source;
    if (!source) return customTitle;
    if (source.indexOf(DEFAULT_TITLE) !== -1) {
      return source.split(DEFAULT_TITLE).join(customTitle);
    }
    return source;
  }

  function applyTitle(customTitle) {
    var title = String(customTitle || "").trim();
    if (!title) return;

    var current = String(document.title || "").trim();
    if (!current) {
      document.title = title;
      return;
    }

    document.title = decorateTitle(current) || title;
  }

  function setLinkRel(rel, href, type) {
    var links = document.querySelectorAll('link[rel="' + rel + '"]');
    if (!links.length) {
      var created = document.createElement("link");
      created.rel = rel;
      if (type) created.type = type;
      created.href = href;
      document.head.appendChild(created);
      return;
    }

    for (var i = 0; i < links.length; i += 1) {
      links[i].href = href;
      if (type) links[i].type = type;
    }
  }

  function applyFavicon(faviconUrl) {
    var href = normalizeFavicon(faviconUrl) || DEFAULT_FAVICON;
    setLinkRel("icon", href, "image/png");
    setLinkRel("shortcut icon", href, "image/x-icon");
    setLinkRel("apple-touch-icon", href, "image/png");

    var logo = document.querySelector(".nav__logo-icon");
    if (logo) {
      logo.src = href;
    }
  }

  function applyDocumentSettings() {
    var settings = getSettings();
    applyTitle(settings.title);
    applyFavicon(settings.favicon);
  }

  function setTitle(value) {
    safeSetStorage(TITLE_KEY, value);
    applyDocumentSettings();
  }

  function setFavicon(value) {
    safeSetStorage(FAVICON_KEY, normalizeFavicon(value));
    applyDocumentSettings();
  }

  function reset() {
    safeSetStorage(TITLE_KEY, "");
    safeSetStorage(FAVICON_KEY, "");
    applyDocumentSettings();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function openInAboutBlank(targetUrl) {
    var target = String(targetUrl || window.location.href || "").trim();
    if (!target) return { ok: false, error: "Missing target URL." };

    var newTab = window.open("about:blank", "_blank");
    if (!newTab) {
      return { ok: false, error: "Popup blocked by browser." };
    }

    var settings = getSettings();
    var title = settings.title || DEFAULT_TITLE;
    var favicon = settings.favicon || DEFAULT_FAVICON;

    var html = [
      "<!doctype html>",
      "<html>",
      "<head>",
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      "<title>" + escapeHtml(title) + "</title>",
      '<link rel="icon" href="' + escapeHtml(favicon) + '" />',
      "<style>",
      "html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}",
      "iframe{width:100%;height:100%;border:0;display:block}",
      "</style>",
      "</head>",
      "<body>",
      '<iframe src="' + escapeHtml(target) + '" allow="clipboard-read; clipboard-write; fullscreen"></iframe>',
      "</body>",
      "</html>"
    ].join("");

    newTab.document.open();
    newTab.document.write(html);
    newTab.document.close();
    return { ok: true };
  }

  window.PalladiumSiteSettings = {
    defaultTitle: DEFAULT_TITLE,
    defaultFavicon: DEFAULT_FAVICON,
    getSettings: getSettings,
    setTitle: setTitle,
    setFavicon: setFavicon,
    reset: reset,
    decorateTitle: decorateTitle,
    applyDocumentSettings: applyDocumentSettings,
    openInAboutBlank: openInAboutBlank
  };

  applyDocumentSettings();
})();

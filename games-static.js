(function () {
  var LOCAL_MANIFEST_PATH = "data/games-catalog.json";
  var catalogCache = null;

  function sanitizeText(value) {
    return String(value == null ? "" : value).trim();
  }

  function isRemoteAsset(value) {
    return /^(?:[a-z]+:)?\/\//i.test(value) || /^(?:data|blob):/i.test(value);
  }

  function normalizeAssetPath(value) {
    var text = sanitizeText(value);
    if (!text || isRemoteAsset(text)) return text;
    return text.replace(/^\/+/, "");
  }

  async function loadLocalCatalog(forceRefresh) {
    if (!forceRefresh && catalogCache) {
      return catalogCache.slice();
    }

    var response = await fetch(LOCAL_MANIFEST_PATH, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Local games catalog request failed with status " + response.status);
    }

    var payload = await response.json();
    catalogCache = Array.isArray(payload && payload.games) ? payload.games : [];
    return catalogCache.slice();
  }

  async function loadCatalog(options) {
    var settings = options || {};

    try {
      return await loadLocalCatalog(Boolean(settings.forceRefresh));
    } catch (localError) {
      if (settings.localOnly) {
        throw localError;
      }

      if (
        window.PalladiumBackend &&
        typeof window.PalladiumBackend.fetchJson === "function"
      ) {
        var payload = await window.PalladiumBackend.fetchJson("/api/games");
        catalogCache = Array.isArray(payload && payload.games) ? payload.games : [];
        return catalogCache.slice();
      }

      throw localError;
    }
  }

  window.PalladiumGames = {
    manifestPath: LOCAL_MANIFEST_PATH,
    normalizeAssetPath: normalizeAssetPath,
    loadCatalog: loadCatalog,
    getCachedCatalog: function () {
      return catalogCache ? catalogCache.slice() : [];
    }
  };
})();

(function () {
  var core = window.PalladiumShellCore;
  if (!core) return;

  var STORAGE_KEY = "palladium.shell.state.v1";
  var DEFAULT_PROXY_PROTOCOL = "https:";
  var DEFAULT_PROXY_PORT = 443;

  var elements = {
    addressForm: document.getElementById("address-form"),
    addressInput: document.getElementById("address-input"),
    aiStatusChip: document.getElementById("ai-status-chip"),
    homeButton: document.getElementById("toolbar-home"),
    newTabButton: document.getElementById("shell-new-tab"),
    paneStack: document.getElementById("pane-stack"),
    proxyStatusChip: document.getElementById("proxy-status-chip"),
    refreshButton: document.getElementById("toolbar-refresh"),
    routeList: document.querySelector(".route-list"),
    stageOverlay: document.getElementById("stage-overlay"),
    stageOverlayText: document.getElementById("stage-overlay-text"),
    tabList: document.getElementById("tab-list"),
    toolbarNewTabButton: document.getElementById("toolbar-new-tab")
  };

  var state = {
    activeTabId: "",
    config: null,
    gamesCatalog: null,
    proxyBase: "",
    proxyHealth: {
      ok: false,
      message: "Locating proxy..."
    },
    tabs: []
  };

  function cleanText(value) {
    return core.cleanText(value);
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function readStorage() {
    try {
      var raw = window.sessionStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStorage(payload) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (error) {
      // Ignore storage failures.
    }
  }

  function cloneTemplate(id) {
    var template = document.getElementById(id);
    if (!template) return null;
    return template.content.firstElementChild.cloneNode(true);
  }

  function makeTabId() {
    return "tab-" + Math.random().toString(36).slice(2, 10);
  }

  function describeUri(value) {
    return core.describeInput(value || core.buildInternalUri("newtab"));
  }

  function createTab(uri, existingId) {
    var descriptor = describeUri(uri);
    return {
      aiState: {
        busy: false,
        memory: []
      },
      gamesQuery: "",
      id: existingId || makeTabId(),
      paneEl: null,
      title: descriptor.title,
      route: descriptor.route,
      targetUrl: descriptor.targetUrl || "",
      path: descriptor.path || "",
      author: descriptor.author || "",
      uri: descriptor.uri,
      view: descriptor.view
    };
  }

  function assignDescriptor(tab, descriptor) {
    tab.title = descriptor.title;
    tab.route = descriptor.route;
    tab.targetUrl = descriptor.targetUrl || "";
    tab.path = descriptor.path || "";
    tab.author = descriptor.author || "";
    tab.uri = descriptor.uri;
    tab.view = descriptor.view;
    tab.gamesQuery = tab.view === "games" ? tab.gamesQuery : "";
    if (tab.view !== "ai") {
      tab.aiState = {
        busy: false,
        memory: []
      };
    }
  }

  function getActiveTab() {
    for (var index = 0; index < state.tabs.length; index += 1) {
      if (state.tabs[index].id === state.activeTabId) {
        return state.tabs[index];
      }
    }
    return state.tabs[0] || null;
  }

  function removePane(tab) {
    if (tab && tab.paneEl && tab.paneEl.parentNode) {
      tab.paneEl.parentNode.removeChild(tab.paneEl);
    }
    if (tab) {
      tab.paneEl = null;
    }
  }

  function persistState() {
    writeStorage({
      activeTabId: state.activeTabId,
      tabs: state.tabs.map(function (tab) {
        return {
          id: tab.id,
          uri: tab.uri
        };
      })
    });
  }

  function syncBrowserUrl() {
    var active = getActiveTab();
    try {
      var params = new URLSearchParams(window.location.search || "");
      if (active && active.uri) {
        params.set("uri", active.uri);
      } else {
        params.delete("uri");
      }
      var query = params.toString();
      var nextUrl = window.location.pathname + (query ? "?" + query : "");
      window.history.replaceState(null, "", nextUrl);
    } catch (error) {
      // Ignore history issues.
    }
  }

  function setDocumentTitle(tab) {
    document.title = (tab && tab.title ? tab.title + " | " : "") + "Palladium";
  }

  function setActiveTab(tabId) {
    state.activeTabId = tabId;
    renderShell();
  }

  function openNewTab(uri) {
    var tab = createTab(uri || core.buildInternalUri("newtab"));
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    renderShell();
    if (elements.addressInput) {
      elements.addressInput.focus();
      elements.addressInput.select();
    }
  }

  function closeTab(tabId) {
    var nextTabs = [];
    var removedIndex = -1;

    for (var index = 0; index < state.tabs.length; index += 1) {
      var tab = state.tabs[index];
      if (tab.id === tabId) {
        removedIndex = index;
        removePane(tab);
        continue;
      }
      nextTabs.push(tab);
    }

    state.tabs = nextTabs;

    if (!state.tabs.length) {
      openNewTab(core.buildInternalUri("newtab"));
      return;
    }

    if (state.activeTabId === tabId) {
      var fallbackIndex = Math.max(0, Math.min(removedIndex - 1, state.tabs.length - 1));
      state.activeTabId = state.tabs[fallbackIndex].id;
    }

    renderShell();
  }

  function navigateCurrent(value) {
    var active = getActiveTab();
    var descriptor = describeUri(value);

    if (!active) {
      state.tabs.push(createTab(descriptor.uri));
      state.activeTabId = state.tabs[0].id;
      renderShell();
      return;
    }

    removePane(active);
    assignDescriptor(active, descriptor);
    renderShell();
  }

  function restoreTabs() {
    var restored = readStorage();
    var requestedUri = readRequestedUri();

    if (restored && Array.isArray(restored.tabs) && restored.tabs.length) {
      state.tabs = restored.tabs.map(function (entry) {
        return createTab(entry && entry.uri, entry && entry.id);
      });
      state.activeTabId = restored.activeTabId || state.tabs[0].id;
    }

    if (!state.tabs.length) {
      state.tabs = [createTab(requestedUri || core.buildInternalUri("newtab"))];
      state.activeTabId = state.tabs[0].id;
      return;
    }

    if (requestedUri) {
      navigateCurrent(requestedUri);
    }
  }

  function readRequestedUri() {
    try {
      var params = new URLSearchParams(window.location.search || "");
      return cleanText(params.get("uri"));
    } catch (error) {
      return "";
    }
  }

  function renderTabList() {
    if (!elements.tabList) return;
    elements.tabList.innerHTML = "";

    state.tabs.forEach(function (tab) {
      var card = document.createElement("button");
      card.type = "button";
      card.className = "tab-card" + (tab.id === state.activeTabId ? " tab-card--active" : "");
      card.dataset.tabId = tab.id;

      var icon = document.createElement("span");
      icon.className = "tab-card__icon";
      icon.textContent = tabIcon(tab);

      var body = document.createElement("span");
      body.className = "tab-card__body";

      var title = document.createElement("strong");
      title.className = "tab-card__title";
      title.textContent = tab.title;

      var meta = document.createElement("span");
      meta.className = "tab-card__meta";
      meta.textContent = tab.uri;

      body.appendChild(title);
      body.appendChild(meta);

      var close = document.createElement("button");
      close.type = "button";
      close.className = "tab-card__close";
      close.dataset.closeTab = tab.id;
      close.setAttribute("aria-label", "Close " + tab.title);
      close.textContent = "x";

      card.appendChild(icon);
      card.appendChild(body);
      card.appendChild(close);
      elements.tabList.appendChild(card);
    });
  }

  function tabIcon(tab) {
    if (tab.view === "home") return "NT";
    if (tab.view === "games") return "GM";
    if (tab.view === "ai") return "AI";
    if (tab.view === "game") return "PL";
    return "WB";
  }

  function renderShell() {
    var active = getActiveTab();

    renderTabList();
    renderPanes();
    renderStageOverlay(active);

    if (elements.addressInput && active) {
      elements.addressInput.value = active.uri;
    }

    setDocumentTitle(active);
    syncBrowserUrl();
    persistState();
  }

  function renderPanes() {
    state.tabs.forEach(function (tab) {
      ensurePane(tab);
      if (tab.paneEl) {
        tab.paneEl.classList.toggle("shell-pane--active", tab.id === state.activeTabId);
      }
    });
  }

  function ensurePane(tab) {
    if (tab.paneEl) return;

    if (tab.view === "home") {
      tab.paneEl = createHomePane(tab);
    } else if (tab.view === "games") {
      tab.paneEl = createGamesPane(tab);
    } else if (tab.view === "ai") {
      tab.paneEl = createAiPane(tab);
    } else if (tab.view === "game") {
      tab.paneEl = createGamePane(tab);
    } else {
      tab.paneEl = createWebPane(tab);
    }

    if (tab.paneEl) {
      tab.paneEl.dataset.tabId = tab.id;
      elements.paneStack.appendChild(tab.paneEl);
    }
  }

  function createHomePane() {
    var pane = cloneTemplate("home-pane-template");
    if (!pane) return null;

    pane.addEventListener("click", handlePaneAction);
    fillHomeLibrary(pane);
    return pane;
  }

  function createGamesPane(tab) {
    var pane = cloneTemplate("games-pane-template");
    if (!pane) return null;

    pane.addEventListener("click", handlePaneAction);

    var input = pane.querySelector(".games-search-input");
    if (input) {
      input.value = tab.gamesQuery || "";
      input.addEventListener("input", function () {
        tab.gamesQuery = cleanText(input.value);
        renderGamesCatalog(pane, tab);
      });
    }

    loadGamesCatalog().then(function () {
      renderGamesCatalog(pane, tab);
    }).catch(function () {
      renderGamesFailure(pane);
    });

    return pane;
  }

  function createAiPane(tab) {
    var pane = cloneTemplate("ai-pane-template");
    if (!pane) return null;

    pane.addEventListener("click", handlePaneAction);

    var textarea = pane.querySelector(".ai-chat__input");
    var label = pane.querySelector('label[for="ai-input"]');
    if (textarea) {
      var uniqueId = "ai-input-" + tab.id;
      textarea.id = uniqueId;
      if (label) {
        label.setAttribute("for", uniqueId);
      }
    }

    var form = pane.querySelector('[data-role="ai-form"]');
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        submitAiMessage(tab, pane);
      });
    }

    if (!tab.aiState.memory.length) {
      tab.aiState.memory.push({
        role: "assistant",
        content: "Ask me about the Palladium site, the game catalog, or anything else you want."
      });
    }

    renderAiConversation(pane, tab);
    refreshAiStatus(pane);
    return pane;
  }

  function createGamePane(tab) {
    var pane = document.createElement("section");
    pane.className = "shell-pane shell-pane--frame";

    var frame = document.createElement("iframe");
    frame.className = "shell-pane__frame";
    frame.src = tab.path;
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    frame.setAttribute("referrerpolicy", "no-referrer");
    pane.appendChild(frame);
    return pane;
  }

  function createWebPane(tab) {
    var pane = document.createElement("section");
    pane.className = "shell-pane shell-pane--frame";

    var frame = document.createElement("iframe");
    frame.className = "shell-pane__frame";
    frame.src = buildProxyFrameSrc(tab.targetUrl);
    frame.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    frame.setAttribute("referrerpolicy", "no-referrer");
    pane.appendChild(frame);
    return pane;
  }

  function buildThumbMarkup(game) {
    var image = cleanText(game && game.image);
    if (image) {
      return '<div class="game-card__thumb"><img src="' + escapeHtml(image) + '" alt="' + escapeHtml(game.title) + '" loading="lazy" /></div>';
    }
    return '<div class="game-card__thumb"></div>';
  }

  function buildMiniThumbMarkup(game) {
    var image = cleanText(game && game.image);
    if (image) {
      return '<div class="mini-game-card__thumb"><img src="' + escapeHtml(image) + '" alt="' + escapeHtml(game.title) + '" loading="lazy" /></div>';
    }
    return '<div class="mini-game-card__thumb"></div>';
  }

  function makeLaunchUri(game) {
    if (window.PalladiumGames && typeof window.PalladiumGames.buildLaunchUri === "function") {
      return window.PalladiumGames.buildLaunchUri(game.path, game.title, game.author);
    }
    return core.buildGameUri(game.path, game.title, game.author);
  }

  function fillHomeLibrary(pane) {
    var container = pane.querySelector('[data-role="home-library"]');
    if (!container) return;

    loadGamesCatalog().then(function (games) {
      var sample = games.slice(0, 6);
      if (!sample.length) {
        container.innerHTML = '<div class="empty-state">No local games are available yet.</div>';
        return;
      }

      container.innerHTML = sample.map(function (game) {
        return (
          '<button type="button" class="mini-game-card" data-launch-uri="' + escapeHtml(makeLaunchUri(game)) + '">' +
            buildMiniThumbMarkup(game).replace("game-card__", "mini-game-card__") +
            '<div class="mini-game-card__body">' +
              '<h4 class="mini-game-card__title">' + escapeHtml(game.title) + '</h4>' +
              '<div class="mini-game-card__meta">' + escapeHtml(game.author || "Unknown") + "</div>" +
            "</div>" +
          "</button>"
        );
      }).join("");
    }).catch(function () {
      container.innerHTML = '<div class="empty-state">The local games catalog could not be loaded.</div>';
    });
  }

  function renderGamesCatalog(pane, tab) {
    var statusEl = pane.querySelector('[data-role="games-status"]');
    var featuredEl = pane.querySelector('[data-role="games-featured"]');
    var gridEl = pane.querySelector('[data-role="games-grid"]');
    var query = cleanText(tab.gamesQuery).toLowerCase();

    if (!state.gamesCatalog) {
      if (statusEl) statusEl.textContent = "Loading local catalog...";
      return;
    }

    var games = state.gamesCatalog.filter(function (game) {
      if (!query) return true;
      var haystack = [
        cleanText(game.title),
        cleanText(game.author),
        cleanText(game.category),
        cleanText(game.path)
      ].join(" ").toLowerCase();
      return haystack.indexOf(query) !== -1;
    });

    if (statusEl) {
      statusEl.textContent = query
        ? games.length + (games.length === 1 ? " result" : " results")
        : state.gamesCatalog.length + " games";
    }

    if (featuredEl) {
      if (!games.length) {
        featuredEl.innerHTML = '<div class="empty-state">No games match that search yet.</div>';
      } else {
        var featured = games[0];
        featuredEl.innerHTML =
          '<div class="featured-launch__thumb">' +
            (cleanText(featured.image)
              ? '<img src="' + escapeHtml(featured.image) + '" alt="' + escapeHtml(featured.title) + '" loading="lazy" />'
              : "") +
          "</div>" +
          '<div class="featured-launch__body">' +
            '<h3 class="featured-launch__title">' + escapeHtml(featured.title) + "</h3>" +
            '<p class="featured-launch__meta">' + escapeHtml(featured.author || "Unknown") + " · " + escapeHtml(featured.category || "game") + "</p>" +
            '<p class="featured-launch__meta">Launch it in its own Palladium tab.</p>' +
            '<button type="button" class="toolbar-button toolbar-button--accent featured-launch__cta" data-launch-uri="' + escapeHtml(makeLaunchUri(featured)) + '">Play now</button>' +
          "</div>";
      }
    }

    if (!gridEl) return;

    if (!games.length) {
      gridEl.innerHTML = '<div class="empty-state">Try another search or open a fresh tab.</div>';
      return;
    }

    gridEl.innerHTML = games.map(function (game) {
      return (
        '<button type="button" class="game-card" data-launch-uri="' + escapeHtml(makeLaunchUri(game)) + '">' +
          buildThumbMarkup(game) +
          '<div class="game-card__body">' +
            '<h4 class="game-card__title">' + escapeHtml(game.title) + "</h4>" +
            '<div class="game-card__meta">' + escapeHtml(game.author || "Unknown") + " · " + escapeHtml(game.category || "game") + "</div>" +
          "</div>" +
        "</button>"
      );
    }).join("");
  }

  function renderGamesFailure(pane) {
    var statusEl = pane.querySelector('[data-role="games-status"]');
    var featuredEl = pane.querySelector('[data-role="games-featured"]');
    var gridEl = pane.querySelector('[data-role="games-grid"]');

    if (statusEl) statusEl.textContent = "Catalog unavailable";
    if (featuredEl) {
      featuredEl.innerHTML = '<div class="empty-state">The games catalog could not be loaded right now.</div>';
    }
    if (gridEl) {
      gridEl.innerHTML = "";
    }
  }

  function handlePaneAction(event) {
    var target = event.target;
    if (!target || typeof target.closest !== "function") return;

    var routeButton = target.closest("[data-route]");
    if (routeButton) {
      navigateCurrent(routeButton.getAttribute("data-route"));
      return;
    }

    var launchButton = target.closest("[data-launch-uri]");
    if (launchButton) {
      openNewTab(launchButton.getAttribute("data-launch-uri"));
      return;
    }

    var searchButton = target.closest("[data-query]");
    if (searchButton) {
      navigateCurrent(searchButton.getAttribute("data-query"));
      return;
    }

    var promptButton = target.closest("[data-prompt]");
    if (promptButton) {
      var pane = target.closest(".shell-pane");
      if (!pane) return;
      var active = getActiveTab();
      if (!active || active.id !== pane.dataset.tabId) return;
      var input = pane.querySelector(".ai-chat__input");
      if (!input) return;
      input.value = promptButton.getAttribute("data-prompt");
      input.focus();
    }
  }

  function loadGamesCatalog() {
    if (state.gamesCatalog) {
      return Promise.resolve(state.gamesCatalog.slice());
    }

    if (!window.PalladiumGames || typeof window.PalladiumGames.loadCatalog !== "function") {
      return Promise.reject(new Error("Games helper not available."));
    }

    return window.PalladiumGames.loadCatalog().then(function (games) {
      state.gamesCatalog = Array.isArray(games) ? games : [];
      return state.gamesCatalog.slice();
    });
  }

  function renderAiConversation(pane, tab) {
    var messagesEl = pane.querySelector('[data-role="ai-messages"]');
    if (!messagesEl) return;

    messagesEl.innerHTML = "";
    tab.aiState.memory.forEach(function (message) {
      messagesEl.appendChild(buildAiMessage(message.role, message.content));
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function buildAiMessage(role, text) {
    var bubble = document.createElement("article");
    bubble.className = "ai-message ai-message--" + role;
    bubble.innerHTML =
      '<div class="ai-message__label">' + (role === "user" ? "You" : "Palladium AI") + "</div>" +
      '<div class="ai-message__body">' + renderMarkdown(text || "") + "</div>";
    return bubble;
  }

  function updateAiMessage(bubble, text) {
    if (!bubble) return;
    var body = bubble.querySelector(".ai-message__body");
    if (!body) return;
    body.innerHTML = renderMarkdown(text || "");
  }

  function renderMarkdown(text) {
    var source = String(text || "").replace(/\r/g, "");
    if (!source) return "<p></p>";

    var lines = source.split("\n");
    var html = [];
    var listOpen = false;
    var codeOpen = false;
    var codeLines = [];

    function closeList() {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
    }

    function closeCode() {
      if (codeOpen) {
        html.push("<pre><code>" + escapeHtml(codeLines.join("\n")) + "</code></pre>");
        codeOpen = false;
        codeLines = [];
      }
    }

    for (var index = 0; index < lines.length; index += 1) {
      var line = lines[index];
      var trimmed = line.trim();

      if (/^```/.test(trimmed)) {
        closeList();
        if (codeOpen) {
          closeCode();
        } else {
          codeOpen = true;
        }
        continue;
      }

      if (codeOpen) {
        codeLines.push(line);
        continue;
      }

      if (!trimmed) {
        closeList();
        continue;
      }

      if (/^[-*]\s+/.test(trimmed)) {
        if (!listOpen) {
          html.push("<ul>");
          listOpen = true;
        }
        html.push("<li>" + inlineMarkdown(trimmed.replace(/^[-*]\s+/, "")) + "</li>");
        continue;
      }

      closeList();
      html.push("<p>" + inlineMarkdown(trimmed) + "</p>");
    }

    closeCode();
    closeList();
    return html.join("");
  }

  function inlineMarkdown(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function refreshAiStatus(pane) {
    var statusEl = pane.querySelector('[data-role="ai-status"]');

    if (!window.PalladiumBackend || typeof window.PalladiumBackend.getPublicConfig !== "function") {
      if (statusEl) statusEl.textContent = "Backend helper unavailable";
      if (elements.aiStatusChip) elements.aiStatusChip.textContent = "Backend missing";
      return;
    }

    window.PalladiumBackend.getPublicConfig().then(function (config) {
      state.config = config || state.config;
      var model = cleanText(config && config.services && config.services.defaultAiModel) || "AI";
      if (statusEl) statusEl.textContent = "Online · " + model;
      if (elements.aiStatusChip) elements.aiStatusChip.textContent = model;
    }).catch(function () {
      if (statusEl) statusEl.textContent = "AI backend unavailable";
      if (elements.aiStatusChip) elements.aiStatusChip.textContent = "Offline";
    });
  }

  function submitAiMessage(tab, pane) {
    if (tab.aiState.busy) return;
    var input = pane.querySelector(".ai-chat__input");
    var messagesEl = pane.querySelector('[data-role="ai-messages"]');
    if (!input || !messagesEl) return;

    var text = cleanText(input.value);
    if (!text) return;

    input.value = "";
    tab.aiState.busy = true;

    var userMessage = { role: "user", content: text };
    tab.aiState.memory.push(userMessage);
    var userBubble = buildAiMessage(userMessage.role, userMessage.content);
    messagesEl.appendChild(userBubble);

    var assistantBubble = buildAiMessage("assistant", "Thinking...");
    messagesEl.appendChild(assistantBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    requestAiResponse(tab, text, function (combined) {
      updateAiMessage(assistantBubble, combined || "Thinking...");
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }).then(function (answer) {
      tab.aiState.memory.push({ role: "assistant", content: answer });
      updateAiMessage(assistantBubble, answer);
    }).catch(function (error) {
      updateAiMessage(assistantBubble, "AI error: " + cleanText(error && error.message ? error.message : error));
    }).finally(function () {
      tab.aiState.busy = false;
    });
  }

  function extractAssistantText(rawText) {
    var trimmed = String(rawText || "").trim();
    if (!trimmed) return "";

    function contentFromParsed(parsed) {
      if (!parsed || typeof parsed !== "object") return "";

      if (parsed.message && typeof parsed.message.content === "string") {
        return parsed.message.content;
      }

      if (typeof parsed.response === "string") {
        return parsed.response;
      }

      if (typeof parsed.content === "string") {
        return parsed.content;
      }

      if (Array.isArray(parsed.choices) && parsed.choices.length) {
        var first = parsed.choices[0] || {};
        if (first.message && typeof first.message.content === "string") {
          return first.message.content;
        }
        if (typeof first.text === "string") {
          return first.text;
        }
      }

      return "";
    }

    try {
      return contentFromParsed(JSON.parse(trimmed)) || trimmed;
    } catch (error) {
      return trimmed;
    }
  }

  function extractErrorText(rawText) {
    var trimmed = String(rawText || "").trim();
    if (!trimmed) return "";

    try {
      var parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed.error === "string") {
        return parsed.error;
      }
    } catch (error) {
      return "";
    }

    return "";
  }

  function isRecoverableStreamError(error) {
    var message = cleanText(error && error.message ? error.message : error).toLowerCase();
    return (
      message.indexOf("failed to fetch") !== -1 ||
      message.indexOf("timed out") !== -1 ||
      message.indexOf("client disconnected") !== -1
    );
  }

  function requestAi(payload, onDelta) {
    return fetch(window.PalladiumBackend.apiUrl("/api/ai/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch(function (error) {
      if (payload.stream && isRecoverableStreamError(error)) {
        return requestAi(Object.assign({}, payload, { stream: false }), null);
      }
      throw error;
    }).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (raw) {
          throw new Error(extractErrorText(raw) || raw || ("AI request failed: " + response.status));
        });
      }

      if (payload.stream && response.body && typeof response.body.getReader === "function") {
        return streamAiResponse(response, payload, onDelta);
      }

      return response.text().then(function (raw) {
        var err = extractErrorText(raw);
        if (err) throw new Error(err);
        return extractAssistantText(raw);
      });
    });
  }

  function streamAiResponse(response, payload, onDelta) {
    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var buffer = "";
    var combined = "";

    function applySegment(segment) {
      if (!segment) return;
      combined += segment;
      if (typeof onDelta === "function") {
        onDelta(combined, segment);
      }
    }

    function pump() {
      return reader.read().then(function (chunk) {
        if (chunk.done) {
          if (String(buffer || "").trim()) {
            try {
              var tail = JSON.parse(buffer.trim());
              if (typeof tail.delta === "string") {
                applySegment(tail.delta);
              } else {
                applySegment(extractAssistantText(tail));
              }
            } catch (error) {
              // Ignore malformed trailing bytes.
            }
          }
          return combined;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        var newlineIndex = buffer.indexOf("\n");

        while (newlineIndex !== -1) {
          var line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) {
            try {
              var part = JSON.parse(line);
              if (part && part.error) {
                throw new Error(String(part.error));
              }
              if (typeof part.delta === "string") {
                applySegment(part.delta);
              } else {
                applySegment(extractAssistantText(part));
              }
            } catch (error) {
              if (!/Unexpected token|JSON/.test(String(error.message || ""))) {
                throw error;
              }
            }
          }
          newlineIndex = buffer.indexOf("\n");
        }

        return pump();
      });
    }

    return pump().catch(function (error) {
      if (isRecoverableStreamError(error)) {
        return requestAi(Object.assign({}, payload, { stream: false }), null);
      }
      throw error;
    });
  }

  function buildAiSystemPrompt(userText) {
    var lines = [
      "You are Palladium AI for the Palladium browser shell.",
      "Never make up games, links, or site features.",
      "Always format replies in Markdown.",
      "Prefer short, direct answers."
    ];

    if (!/\b(game|games|catalog|library|title|author|play)\b/i.test(userText || "")) {
      lines.push("If asked for game suggestions, use only the provided local catalog.");
      return Promise.resolve(lines.join("\n"));
    }

    return loadGamesCatalog().then(function (games) {
      lines.push("When answering about games, use ONLY this catalog.");
      lines.push("Catalog:");
      lines.push(
        games.slice(0, 40).map(function (game) {
          return "- " + game.title + " | " + game.author + " | " + game.path;
        }).join("\n")
      );
      return lines.join("\n");
    }).catch(function () {
      return lines.join("\n");
    });
  }

  function requestAiResponse(tab, userText, onDelta) {
    if (!window.PalladiumBackend) {
      return Promise.reject(new Error("Backend helper not loaded."));
    }

    return buildAiSystemPrompt(userText).then(function (systemPrompt) {
      var messages = [{ role: "system", content: systemPrompt }];
      tab.aiState.memory.forEach(function (message) {
        messages.push(message);
      });
      messages.push({ role: "user", content: userText });

      return requestAi({
        messages: messages,
        stream: true
      }, onDelta);
    });
  }

  function normalizeBase(value) {
    var raw = cleanText(value);
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) {
      raw = "http://" + raw;
    }
    raw = raw.replace(/\/+$/, "");
    try {
      return new URL(raw).origin;
    } catch (error) {
      return "";
    }
  }

  function resolveProxyBase() {
    if (state.config && state.config.services && state.config.services.proxyBase) {
      return Promise.resolve(normalizeBase(state.config.services.proxyBase));
    }

    if (window.PalladiumBackend && typeof window.PalladiumBackend.getPublicConfig === "function") {
      return window.PalladiumBackend.getPublicConfig().then(function (config) {
        state.config = config || state.config;
        var explicit = normalizeBase(config && config.services && config.services.proxyBase);
        if (explicit) return explicit;

        var backendBase = normalizeBase(config && config.backendBase);
        if (backendBase) {
          try {
            var parsed = new URL(backendBase);
            parsed.protocol = DEFAULT_PROXY_PROTOCOL;
            parsed.port = String(DEFAULT_PROXY_PORT);
            return parsed.origin;
          } catch (error) {
            return "";
          }
        }

        return "";
      }).catch(function () {
        return "";
      });
    }

    return Promise.resolve("");
  }

  function checkProxyHealth(base) {
    if (!base) {
      return Promise.resolve({
        ok: false,
        message: "No proxy base is configured yet."
      });
    }

    return fetch(base + "/health", { method: "GET" }).then(function (response) {
      if (!response.ok) {
        return {
          ok: false,
          message: "Proxy health endpoint returned status " + response.status + "."
        };
      }

      return {
        ok: true,
        message: "Connected to proxy at " + base
      };
    }).catch(function () {
      return {
        ok: false,
        message: "Proxy is offline at " + base + ". Start or restart the backend."
      };
    });
  }

  function buildProxyFrameSrc(targetUrl) {
    if (!state.proxyBase) return "about:blank";
    var query = new URLSearchParams();
    query.set("url", targetUrl);
    return state.proxyBase.replace(/\/+$/, "") + "/?" + query.toString();
  }

  function refreshProxyStatus() {
    resolveProxyBase().then(function (base) {
      state.proxyBase = base;
      return checkProxyHealth(base);
    }).then(function (health) {
      state.proxyHealth = health;
      if (elements.proxyStatusChip) {
        elements.proxyStatusChip.textContent = health.ok ? "Connected" : "Offline";
      }
      refreshAllWebFrames();
      renderStageOverlay(getActiveTab());
    }).catch(function () {
      state.proxyHealth = {
        ok: false,
        message: "Proxy detection failed."
      };
      if (elements.proxyStatusChip) {
        elements.proxyStatusChip.textContent = "Unavailable";
      }
      renderStageOverlay(getActiveTab());
    });
  }

  function refreshAllWebFrames() {
    state.tabs.forEach(function (tab) {
      if (tab.view !== "web" || !tab.paneEl) return;
      var frame = tab.paneEl.querySelector("iframe");
      if (frame) {
        frame.src = buildProxyFrameSrc(tab.targetUrl);
      }
    });
  }

  function renderStageOverlay(active) {
    if (!elements.stageOverlay || !elements.stageOverlayText) return;

    var show = Boolean(active && active.view === "web" && !state.proxyHealth.ok);
    elements.stageOverlay.hidden = !show;
    elements.stageOverlayText.textContent = state.proxyHealth.message;
  }

  function refreshActivePane() {
    var active = getActiveTab();
    if (!active) return;

    if (active.view === "home") {
      removePane(active);
      ensurePane(active);
    } else if (active.view === "games") {
      state.gamesCatalog = null;
      removePane(active);
      ensurePane(active);
    } else if (active.view === "web") {
      var webFrame = active.paneEl && active.paneEl.querySelector("iframe");
      if (webFrame) webFrame.src = buildProxyFrameSrc(active.targetUrl);
    } else if (active.view === "game") {
      var gameFrame = active.paneEl && active.paneEl.querySelector("iframe");
      if (gameFrame) gameFrame.src = active.path;
    }

    renderShell();
  }

  function bindEvents() {
    if (elements.addressForm && elements.addressInput) {
      elements.addressForm.addEventListener("submit", function (event) {
        event.preventDefault();
        navigateCurrent(elements.addressInput.value);
      });
    }

    if (elements.homeButton) {
      elements.homeButton.addEventListener("click", function () {
        navigateCurrent(core.buildInternalUri("home"));
      });
    }

    if (elements.refreshButton) {
      elements.refreshButton.addEventListener("click", refreshActivePane);
    }

    if (elements.newTabButton) {
      elements.newTabButton.addEventListener("click", function () {
        openNewTab(core.buildInternalUri("newtab"));
      });
    }

    if (elements.toolbarNewTabButton) {
      elements.toolbarNewTabButton.addEventListener("click", function () {
        openNewTab(core.buildInternalUri("newtab"));
      });
    }

    if (elements.tabList) {
      elements.tabList.addEventListener("click", function (event) {
        var target = event.target;
        if (!target || typeof target.closest !== "function") return;

        var closeButton = target.closest("[data-close-tab]");
        if (closeButton) {
          event.stopPropagation();
          closeTab(closeButton.getAttribute("data-close-tab"));
          return;
        }

        var tabCard = target.closest("[data-tab-id]");
        if (tabCard) {
          setActiveTab(tabCard.getAttribute("data-tab-id"));
        }
      });
    }

    if (elements.routeList) {
      elements.routeList.addEventListener("click", function (event) {
        var target = event.target;
        if (!target || typeof target.closest !== "function") return;
        var routeButton = target.closest("[data-route]");
        if (!routeButton) return;
        navigateCurrent(routeButton.getAttribute("data-route"));
      });
    }

    document.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "l") {
        event.preventDefault();
        if (elements.addressInput) {
          elements.addressInput.focus();
          elements.addressInput.select();
        }
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t") {
        event.preventDefault();
        openNewTab(core.buildInternalUri("newtab"));
      }
    });
  }

  restoreTabs();
  bindEvents();
  renderShell();
  refreshProxyStatus();
})();

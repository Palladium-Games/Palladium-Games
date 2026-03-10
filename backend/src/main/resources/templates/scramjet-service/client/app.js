import { BareMuxConnection } from "/baremux/index.mjs";

const DEFAULT_HOME = "https://www.bing.com/";
const NEW_TAB_LABEL = "New Tab";

const tabsStrip = document.getElementById("tabs-strip");
const newTabButton = document.getElementById("new-tab-btn");
const form = document.getElementById("proxy-form");
const backButton = document.getElementById("back-btn");
const forwardButton = document.getElementById("forward-btn");
const reloadButton = document.getElementById("reload-btn");
const homeButton = document.getElementById("home-btn");
const input = document.getElementById("url-input");
const frameHost = document.getElementById("frame-host");
const statusText = document.getElementById("status-text");
const siteTitle = document.getElementById("site-title");
const favicon = document.getElementById("site-favicon");

let tabs = [];
let activeTabId = "";
let tabCounter = 1;
let scramjetController = null;
let transportConnection = null;

boot().catch((error) => {
  console.error(error);
  setStatus(error instanceof Error ? error.message : "Proxy initialization failed", true);
});

async function boot() {
  if (typeof window.$scramjetLoadController !== "function") {
    throw new Error("Scramjet 2 runtime was not loaded.");
  }

  setStatus("Preparing service worker...");

  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await registration.update().catch(() => {
    // Ignore update errors and continue with the currently active worker.
  });
  await navigator.serviceWorker.ready;

  await configureTransport();

  setStatus("Initializing Scramjet...");
  const { ScramjetController } = window.$scramjetLoadController();
  scramjetController = new ScramjetController({
    prefix: "/scramjet/",
    files: {
      wasm: "/scram/scramjet.wasm.wasm",
      all: "/scram/scramjet.all.js",
      sync: "/scram/scramjet.sync.js"
    }
  });
  await scramjetController.init();

  bindEvents();

  const params = new URLSearchParams(window.location.search);
  const initialInput = (params.get("url") || DEFAULT_HOME).trim();
  const firstTab = createTab();
  setActiveTab(firstTab.id);

  await navigate(initialInput, firstTab);
  setStatus("Ready");
}

async function configureTransport() {
  setStatus("Connecting transport...");

  try {
    transportConnection = new BareMuxConnection("/baremux/worker.js");
    await transportConnection.setTransport("/baremod/index.mjs", [`${location.origin}/bare/`]);
    return;
  } catch (error) {
    console.warn("BareMuxConnection setup failed, trying legacy transport fallback.", error);
  }

  if (window.BareMux?.SetTransport) {
    window.BareMux.SetTransport("BareMod.BareClient", `${location.origin}/bare/`);
    const switcher = window.BareMux.findSwitcher?.();
    if (switcher?.data && switcher?.channel) {
      switcher.channel.postMessage(switcher.data);
    }
    if (switcher?.active?.initpromise) {
      await switcher.active.initpromise;
    }
    return;
  }

  throw new Error("Could not initialize proxy transport.");
}

function bindEvents() {
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userInput = input?.value || "";
    await navigate(userInput, getActiveTab());
  });

  backButton?.addEventListener("click", () => {
    getActiveTab()?.scramjetFrame?.back();
  });

  forwardButton?.addEventListener("click", () => {
    getActiveTab()?.scramjetFrame?.forward();
  });

  reloadButton?.addEventListener("click", () => {
    getActiveTab()?.scramjetFrame?.reload();
  });

  homeButton?.addEventListener("click", async () => {
    await navigate(DEFAULT_HOME, getActiveTab());
  });

  newTabButton?.addEventListener("click", async () => {
    const tab = createTab();
    setActiveTab(tab.id);
    await navigate(DEFAULT_HOME, tab);
  });

  window.addEventListener("keydown", async (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "t") {
      event.preventDefault();
      const tab = createTab();
      setActiveTab(tab.id);
      await navigate(DEFAULT_HOME, tab);
    }
  });
}

function createTab() {
  if (!scramjetController) {
    throw new Error("Scramjet controller is not initialized.");
  }

  const frame = document.createElement("iframe");
  frame.title = "Palladium Browse";
  frame.referrerPolicy = "no-referrer";
  frame.classList.add("is-hidden");

  const scramjetFrame = scramjetController.createFrame(frame);

  const tab = {
    id: `tab-${tabCounter++}`,
    frame,
    scramjetFrame,
    url: DEFAULT_HOME,
    title: NEW_TAB_LABEL,
    favicon: "",
    lastObservedFrameUrl: "",
    metaRequestId: 0,
    lastAutoRetryUrl: "",
    searchFallbackUsedForUrl: "",
    ui: null
  };

  frame.addEventListener("load", () => {
    syncUrlFromFrame(tab);
    detectProxyErrorPage(tab);
  });

  scramjetFrame.addEventListener("navigate", (event) => {
    handleFrameUrlEvent(tab, event.url, "Loading");
  });

  scramjetFrame.addEventListener("urlchange", (event) => {
    handleFrameUrlEvent(tab, event.url, "Ready");
  });

  frameHost?.appendChild(frame);
  tab.ui = buildTabUi(tab);
  tabs.push(tab);

  if (tabs.length === 1) {
    frame.classList.remove("is-hidden");
  }

  return tab;
}

function buildTabUi(tab) {
  const item = document.createElement("div");
  item.className = "proxy-tab";
  item.setAttribute("role", "tab");
  item.setAttribute("aria-selected", "false");
  item.dataset.tabId = tab.id;

  const main = document.createElement("button");
  main.type = "button";
  main.className = "proxy-tab__main";
  main.title = "Switch tab";
  main.addEventListener("click", () => {
    setActiveTab(tab.id);
  });

  const icon = document.createElement("img");
  icon.className = "proxy-tab__favicon";
  icon.alt = "";
  icon.src = defaultFaviconForHost("");

  const title = document.createElement("span");
  title.className = "proxy-tab__title";
  title.textContent = NEW_TAB_LABEL;

  const close = document.createElement("button");
  close.type = "button";
  close.className = "proxy-tab__close";
  close.title = "Close tab";
  close.textContent = "\u00d7";
  close.addEventListener("click", (event) => {
    event.stopPropagation();
    closeTab(tab.id);
  });

  main.append(icon, title);
  item.append(main, close);

  if (tabsStrip && newTabButton) {
    tabsStrip.insertBefore(item, newTabButton);
  } else if (tabsStrip) {
    tabsStrip.appendChild(item);
  }

  return { item, icon, title };
}

function setActiveTab(tabId) {
  activeTabId = tabId;

  for (const tab of tabs) {
    const isActive = tab.id === tabId;
    tab.frame.classList.toggle("is-hidden", !isActive);
    tab.ui?.item.classList.toggle("is-active", isActive);
    tab.ui?.item.setAttribute("aria-selected", String(isActive));
  }

  const active = getActiveTab();
  if (!active) {
    return;
  }

  if (input) {
    input.value = active.url;
  }

  renderActiveTabMeta(active);
}

function closeTab(tabId) {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) {
    return;
  }

  if (tabs.length === 1) {
    void navigate(DEFAULT_HOME, tabs[0]);
    return;
  }

  const wasActive = tabs[index].id === activeTabId;
  const [removed] = tabs.splice(index, 1);
  removed.frame.remove();
  removed.ui?.item.remove();

  if (!wasActive) {
    return;
  }

  const fallbackIndex = Math.max(0, index - 1);
  const next = tabs[fallbackIndex] || tabs[0];
  if (next) {
    setActiveTab(next.id);
  }
}

function getActiveTab() {
  return tabs.find((tab) => tab.id === activeTabId) || null;
}

async function navigate(inputValue, tab) {
  if (!tab) {
    return;
  }

  const target = normalizeInput(inputValue);
  if (!target) {
    return;
  }

  tab.url = target;
  tab.lastObservedFrameUrl = target;

  if (tab.id === activeTabId && input) {
    input.value = target;
  }

  setStatus(`Loading ${target}`);

  try {
    tab.scramjetFrame.go(target);
  } catch (error) {
    console.error(error);
    setStatus(`Failed to load ${target}`, true);
    return;
  }

  await updateSiteMeta(tab, target);
}

function normalizeInput(raw) {
  const value = raw.trim();
  if (!value) {
    return "";
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) {
    return value;
  }

  if (value.includes(" ") || !value.includes(".")) {
    return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
  }

  return `https://${value}`;
}

function syncUrlFromFrame(tab) {
  let current;
  try {
    current = tab.scramjetFrame.url?.toString();
  } catch {
    return;
  }

  if (!current) {
    return;
  }

  handleFrameUrlEvent(tab, current, "Ready");
}

function handleFrameUrlEvent(tab, rawUrl, statusLabel) {
  const decoded = decodeUrlIfNeeded(rawUrl);
  if (!decoded || decoded === tab.lastObservedFrameUrl) {
    if (tab.id === activeTabId && statusLabel) {
      setStatus(statusLabel);
    }
    return;
  }

  tab.lastObservedFrameUrl = decoded;
  tab.url = decoded;

  if (tab.id === activeTabId && input) {
    input.value = decoded;
  }

  void updateSiteMeta(tab, decoded);

  if (tab.id === activeTabId && statusLabel) {
    setStatus(statusLabel);
  }
}

function decodeUrlIfNeeded(rawUrl) {
  if (!rawUrl) {
    return "";
  }

  if (!scramjetController) {
    return rawUrl;
  }

  try {
    return scramjetController.decodeUrl(rawUrl);
  } catch {
    return rawUrl;
  }
}

async function updateSiteMeta(tab, urlValue) {
  const requestId = ++tab.metaRequestId;
  let parsedUrl;

  try {
    parsedUrl = new URL(urlValue);
    tab.title = parsedUrl.hostname || NEW_TAB_LABEL;
    tab.favicon = defaultFaviconForHost(parsedUrl.hostname);
  } catch {
    tab.title = NEW_TAB_LABEL;
    tab.favicon = defaultFaviconForHost("");
    renderTabMeta(tab);
    return;
  }

  renderTabMeta(tab);

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return;
  }

  try {
    const response = await fetch(`/api/meta?url=${encodeURIComponent(urlValue)}`);
    if (!response.ok) {
      return;
    }

    const payload = await response.json();
    if (requestId !== tab.metaRequestId) {
      return;
    }

    if (payload.title) {
      tab.title = payload.title;
    }

    if (payload.favicon) {
      tab.favicon = payload.favicon;
    }

    renderTabMeta(tab);
  } catch {
    // Keep fallback metadata when upstream title/favicon fetch fails.
  }
}

function renderTabMeta(tab) {
  if (tab.ui?.title) {
    tab.ui.title.textContent = tab.title || NEW_TAB_LABEL;
  }

  if (tab.ui?.icon) {
    tab.ui.icon.src = tab.favicon || defaultFaviconForHost("");
  }

  if (tab.id === activeTabId) {
    renderActiveTabMeta(tab);
  }
}

function renderActiveTabMeta(tab) {
  if (siteTitle) {
    siteTitle.textContent = tab.title || NEW_TAB_LABEL;
  }
  if (favicon) {
    favicon.src = tab.favicon || defaultFaviconForHost("");
  }
}

function defaultFaviconForHost(hostname) {
  if (!hostname) {
    return "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

function detectProxyErrorPage(tab) {
  let doc;
  try {
    doc = tab.frame.contentDocument;
  } catch {
    return;
  }

  if (!doc) {
    return;
  }

  const title = (doc.title || "").toLowerCase();
  const bodyText = (doc.body?.innerText || "").toLowerCase();
  const looksLikeProxyError =
    title.includes("error processing your request") ||
    bodyText.includes("error processing your request") ||
    (bodyText.includes("failed to load") && bodyText.includes("internal server error"));

  if (!looksLikeProxyError) {
    if (tab.lastAutoRetryUrl === tab.url) {
      tab.lastAutoRetryUrl = "";
    }
    return;
  }

  if (tab.lastAutoRetryUrl !== tab.url) {
    tab.lastAutoRetryUrl = tab.url;
    setStatus(`Retrying ${tab.url}...`, true);
    window.setTimeout(() => {
      void navigate(tab.url, tab);
    }, 120);
    return;
  }

  if (isSearchProviderUrl(tab.url) && tab.searchFallbackUsedForUrl !== tab.url) {
    tab.searchFallbackUsedForUrl = tab.url;
    const fallback = toBingSearchOrHome(tab.url);
    setStatus("Search provider failed in this network. Switching to Bing fallback...", true);
    void navigate(fallback, tab);
    return;
  }

  setStatus(`Failed to load ${tab.url}`, true);
}

function isSearchProviderUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.hostname === "duckduckgo.com" ||
      url.hostname === "www.duckduckgo.com" ||
      url.hostname === "google.com" ||
      url.hostname === "www.google.com"
    );
  } catch {
    return false;
  }
}

function toBingSearchOrHome(value) {
  try {
    const url = new URL(value);
    const q = url.searchParams.get("q");
    if (q && q.trim()) {
      return `https://www.bing.com/search?q=${encodeURIComponent(q)}`;
    }
    return DEFAULT_HOME;
  } catch {
    return DEFAULT_HOME;
  }
}

function setStatus(text, isError = false) {
  if (!statusText) {
    return;
  }
  statusText.textContent = text;
  statusText.classList.toggle("is-error", Boolean(isError));
}

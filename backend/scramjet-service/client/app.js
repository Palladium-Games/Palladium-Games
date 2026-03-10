const DEFAULT_HOME = "https://duckduckgo.com/";
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

boot().catch((error) => {
  console.error(error);
  setStatus(error instanceof Error ? error.message : "Proxy initialization failed", true);
});

async function boot() {
  if (!window.BareMux || !window.BareMod || !self.__scramjet$config || !self.__scramjet$bundle) {
    throw new Error("Scramjet runtime was not loaded.");
  }

  setStatus("Preparing service worker...");

  if (!("serviceWorker" in navigator)) {
    throw new Error("This browser does not support service workers.");
  }

  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  setStatus("Connecting transport...");
  BareMux.SetTransport("BareMod.BareClient", `${location.origin}/bare/`);
  const switcher = BareMux.findSwitcher?.();
  if (switcher?.data && switcher?.channel) {
    switcher.channel.postMessage(switcher.data);
  }
  if (switcher?.active?.initpromise) {
    await switcher.active.initpromise;
  }

  bindEvents();
  beginFrameTracking();

  const params = new URLSearchParams(window.location.search);
  const initialInput = (params.get("url") || DEFAULT_HOME).trim();
  const firstTab = createTab();
  setActiveTab(firstTab.id);

  await navigate(initialInput, firstTab);
  setStatus("Ready");
}

function bindEvents() {
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const userInput = input?.value || "";
    await navigate(userInput, getActiveTab());
  });

  backButton?.addEventListener("click", () => {
    getActiveTab()?.frame.contentWindow?.history.back();
  });

  forwardButton?.addEventListener("click", () => {
    getActiveTab()?.frame.contentWindow?.history.forward();
  });

  reloadButton?.addEventListener("click", () => {
    getActiveTab()?.frame.contentWindow?.location.reload();
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
  const tab = {
    id: `tab-${tabCounter++}`,
    frame: document.createElement("iframe"),
    url: DEFAULT_HOME,
    title: NEW_TAB_LABEL,
    favicon: "",
    lastObservedFrameUrl: "",
    metaRequestId: 0,
    ui: null
  };

  tab.frame.title = "Palladium Browse";
  tab.frame.referrerPolicy = "no-referrer";
  tab.frame.classList.add("is-hidden");
  tab.frame.addEventListener("load", () => {
    updateFromFrameLocation(tab);
  });
  frameHost.appendChild(tab.frame);

  tab.ui = buildTabUi(tab);
  tabs.push(tab);

  if (tabs.length === 1) {
    tab.frame.classList.remove("is-hidden");
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
  tab.lastObservedFrameUrl = "";

  if (tab.id === activeTabId && input) {
    input.value = target;
  }

  setStatus(`Loading ${target}`);
  tab.frame.src = encodeProxyUrl(target);

  updateSiteMeta(tab, target);
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
    return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`;
  }

  return `https://${value}`;
}

function encodeProxyUrl(target) {
  return `${location.origin}${self.__scramjet$config.prefix}${self.__scramjet$config.codec.encode(target)}`;
}

function decodeProxyUrl(proxiedUrl) {
  const expectedPrefix = `${location.origin}${self.__scramjet$config.prefix}`;
  if (!proxiedUrl.startsWith(expectedPrefix)) {
    return proxiedUrl;
  }

  return self.__scramjet$config.codec.decode(proxiedUrl.slice(expectedPrefix.length));
}

function beginFrameTracking() {
  window.setInterval(() => {
    const active = getActiveTab();
    if (active) {
      updateFromFrameLocation(active);
    }
  }, 500);
}

function updateFromFrameLocation(tab) {
  if (!tab.frame.contentWindow) {
    return;
  }

  let rawHref;
  try {
    rawHref = tab.frame.contentWindow.location.href;
  } catch {
    return;
  }

  if (!rawHref || rawHref === tab.lastObservedFrameUrl) {
    return;
  }

  tab.lastObservedFrameUrl = rawHref;

  let decoded;
  try {
    decoded = decodeProxyUrl(rawHref);
  } catch {
    decoded = rawHref;
  }

  if (decoded && decoded !== tab.url) {
    tab.url = decoded;
    if (tab.id === activeTabId && input) {
      input.value = decoded;
    }
    updateSiteMeta(tab, decoded);
  }

  if (tab.id === activeTabId) {
    setStatus("Ready");
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
    favicon.src = tab.favicon || "";
  }
}

function defaultFaviconForHost(hostname) {
  if (!hostname) {
    return "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  }
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

function setStatus(text, isError = false) {
  if (!statusText) {
    return;
  }
  statusText.textContent = text;
  statusText.classList.toggle("is-error", Boolean(isError));
}

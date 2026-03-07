"use strict";
const form = document.getElementById("sj-form");
const address = document.getElementById("sj-address");
const searchEngine = document.getElementById("sj-search-engine");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
  files: {
    wasm: "/scram/scramjet.wasm.wasm",
    all: "/scram/scramjet.all.js",
    sync: "/scram/scramjet.sync.js",
  },
});

scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

const wispUrl =
  (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";

// Ensure transport is set and WASM has time to load before first request (fixes "wasm not loaded yet")
let transportReadyPromise = null;

async function ensureTransportReady() {
  if (transportReadyPromise) return transportReadyPromise;
  transportReadyPromise = (async () => {
    try {
      await registerSW();
    } catch (err) {
      if (error) error.textContent = "Failed to register service worker.";
      if (errorCode) errorCode.textContent = err.toString();
      throw err;
    }
    if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
      await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
    }
    // Give the worker time to load libcurl WASM before first request
    await new Promise((r) => setTimeout(r, 2500));
  })();
  return transportReadyPromise;
}

async function goToUrl(url) {
  if (!url || !url.trim()) return;
  try {
    await ensureTransportReady();
  } catch (err) {
    throw err;
  }
  const loadingEl = document.getElementById("sj-loading");
  if (loadingEl) loadingEl.style.display = "none";
  const frame = scramjet.createFrame();
  frame.frame.id = "sj-frame";
  document.body.appendChild(frame.frame);
  frame.go(url);

  // Tell parent (browse.html) the current URL so it can update its address bar
  function sendUrlToParent(u) {
    try {
      var s = u;
      if (u && typeof u === "object" && u.href) s = u.href;
      if (s && (window.parent !== window)) window.parent.postMessage({ type: "palladium-frame-url", url: String(s) }, "*");
    } catch (e) {}
  }
  sendUrlToParent(url);
  try {
    frame.addEventListener("urlchange", function (ev) {
      try {
        var cur = (ev && ev.url) || frame.url;
        sendUrlToParent(cur);
      } catch (e) {}
    });
  } catch (e) {}
}

// Support ?url= or ?destination= when embedded in iframe (e.g. from browse.html)
function getInitialUrl() {
  const params = new URLSearchParams(location.search);
  const u = params.get("url") || params.get("destination");
  if (!u) return null;
  try {
    return decodeURIComponent(u);
  } catch (e) {
    return u;
  }
}

// When opened with ?url=, hide the proxy's search form so only the frame shows (auto-search)
const initialUrl = getInitialUrl();
if (initialUrl) {
  document.body.classList.add("auto-navigate");
  if (address) address.value = initialUrl;
  ensureTransportReady().then(() => goToUrl(initialUrl)).catch((err) => {
    document.body.classList.remove("auto-navigate");
    if (error) error.textContent = err.message || "Failed to load.";
    if (errorCode) errorCode.textContent = err.toString();
  });
} else {
  // Preload transport so WASM is ready when user submits the form
  ensureTransportReady().catch(() => {});
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = search(address.value, searchEngine.value);
  try {
    await goToUrl(url);
  } catch (err) {
    if (error) error.textContent = err.message || "Failed to load.";
    if (errorCode) errorCode.textContent = err.toString();
  }
});

importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = self.$scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

let configLoadPromise = null;

function ensureConfigLoaded() {
  if (!configLoadPromise) {
    configLoadPromise = scramjet.loadConfig().catch((error) => {
      configLoadPromise = null;
      throw error;
    });
  }
  return configLoadPromise;
}

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(handleFetch(event));
});

async function handleFetch(event) {
  try {
    await ensureConfigLoaded();

    if (scramjet.route(event)) {
      return await scramjet.fetch(event);
    }
  } catch (error) {
    console.error("Scramjet fetch handler failed:", error);
  }

  return fetch(event.request);
}

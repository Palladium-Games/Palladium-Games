/* global $scramjetLoadWorker */

importScripts("/scram/scramjet.all.js");

const workerFactory = typeof $scramjetLoadWorker === "function" ? $scramjetLoadWorker() : null;
const ScramjetServiceWorker = workerFactory && workerFactory.ScramjetServiceWorker;
const scramjet = ScramjetServiceWorker ? new ScramjetServiceWorker() : null;

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  if (!scramjet) return;
  if (!scramjet.route(event)) {
    return;
  }

  event.respondWith((async function () {
    await scramjet.loadConfig();
    return scramjet.fetch(event);
  })());
});

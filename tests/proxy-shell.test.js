const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const FRONTEND_DIR = path.resolve(__dirname, "..");

test("frontend ships static Scramjet proxy assets", () => {
  const requiredFiles = [
    "settings-shell.css",
    path.join("scram", "scramjet.all.js"),
    path.join("scram", "scramjet.sync.js"),
    path.join("scram", "scramjet.wasm.wasm"),
    path.join("baremux", "index.js"),
    path.join("baremux", "worker.js"),
    path.join("libcurl", "index.mjs"),
    "sw.js"
  ];

  for (const relativePath of requiredFiles) {
    assert.ok(fs.existsSync(path.join(FRONTEND_DIR, relativePath)), `Missing proxy asset: ${relativePath}`);
  }
});

test("frontend shell references Scramjet assets and sidebar controls", () => {
  const shellPage = fs.readFileSync(path.join(FRONTEND_DIR, "index.html"), "utf8");

  assert.match(shellPage, /id="sidebar-toggle"/);
  assert.match(shellPage, /baremux\/index\.js/);
  assert.match(shellPage, /scram\/scramjet\.all\.js/);
  assert.match(shellPage, /palladium:\/\/settings/);
  assert.match(shellPage, /Open Palladium In About:Blank/);
  assert.match(shellPage, /palladium:\/\/ai/);
});

test("service worker bootstraps Scramjet from the static frontend origin", () => {
  const serviceWorker = fs.readFileSync(path.join(FRONTEND_DIR, "sw.js"), "utf8");

  assert.match(serviceWorker, /importScripts\("\/scram\/scramjet\.all\.js"\)/);
  assert.match(serviceWorker, /scramjet\.route\(event\)/);
  assert.match(serviceWorker, /scramjet\.fetch\(event\)/);
});

test("settings shell keeps the featured game compact and the sidebar on a fixed rail", () => {
  const shellCss = fs.readFileSync(path.join(FRONTEND_DIR, "settings-shell.css"), "utf8");

  assert.match(shellCss, /\.featured-launch\s*\{[\s\S]*grid-template-columns:\s*minmax\(11rem, 12\.75rem\) minmax\(0, 1fr\);/);
  assert.match(shellCss, /\.featured-launch__thumb\s*\{[\s\S]*min-height:\s*clamp\(8\.75rem, 20vh, 10\.5rem\);/);
  assert.match(shellCss, /@media \(max-width: 1100px\)\s*\{[\s\S]*\.shell,\s*\.shell--sidebar-collapsed\s*\{[\s\S]*flex-direction:\s*row;/);
  assert.match(shellCss, /\.shell--sidebar-collapsed \.shell-sidebar\s*\{[\s\S]*flex:\s*0 0 var\(--sidebar-collapsed-width\);/);
});

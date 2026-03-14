const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_DIR = path.resolve(__dirname, "..", "..");
const FRONTEND_DIR = path.join(REPO_DIR, "frontend");

const REQUIRED_FRONTEND_FILES = [
  "index.html",
  "games.html",
  "game-player.html",
  "proxy.html",
  "ai.html",
  "music.html",
  "discord.html",
  "settings.html",
  "styles.css",
  "backend.js",
  "nav.js",
  "site-settings.js",
  "favicon.ico"
];

test("frontend directory contains the required static entrypoints", () => {
  for (const relativePath of REQUIRED_FRONTEND_FILES) {
    const absolutePath = path.join(FRONTEND_DIR, relativePath);
    assert.ok(fs.existsSync(absolutePath), `Missing frontend file: ${relativePath}`);
  }
});

test("frontend directory keeps shared images available for the static host", () => {
  assert.ok(fs.existsSync(path.join(FRONTEND_DIR, "images", "favicon.png")));
  assert.ok(fs.existsSync(path.join(FRONTEND_DIR, "images", "discord.png")));
  assert.ok(!fs.existsSync(path.join(FRONTEND_DIR, "images", "game-img")));
  assert.ok(fs.existsSync(path.join(REPO_DIR, "backend", "images", "game-img")));
});

test("repo root no longer needs duplicate static page copies", () => {
  assert.ok(!fs.existsSync(path.join(REPO_DIR, "index.html")));
  assert.ok(!fs.existsSync(path.join(REPO_DIR, "styles.css")));
  assert.ok(!fs.existsSync(path.join(REPO_DIR, "images")));
});

test("backend ships a Ruffle launcher for SWF games", () => {
  const launcherPath = path.join(REPO_DIR, "backend", "games", "swf", "chibi-knight.html");
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /@ruffle-rs\/ruffle/);
  assert.match(source, /\/swf\/chibi-knight\.swf/);
});

test("backend ships a Ruffle launcher for The Impossible Quiz", () => {
  const launcherPath = path.join(REPO_DIR, "backend", "games", "swf", "the-impossible-quiz.html");
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /@ruffle-rs\/ruffle/);
  assert.match(source, /\/swf\/impossible-quiz\.swf/);
});

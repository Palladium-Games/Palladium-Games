const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const BACKEND_ONLY_ROOT = path.resolve(__dirname, "..");
const HAS_BACKEND_ONLY_LAYOUT = fs.existsSync(path.join(BACKEND_ONLY_ROOT, "apps.js"));
const REPO_DIR = HAS_BACKEND_ONLY_LAYOUT ? BACKEND_ONLY_ROOT : path.resolve(__dirname, "..", "..");
const BACKEND_DIR = HAS_BACKEND_ONLY_LAYOUT ? BACKEND_ONLY_ROOT : path.join(REPO_DIR, "backend");
const FRONTEND_DIR = path.join(REPO_DIR, "frontend");
const HAS_FRONTEND_DIR = fs.existsSync(path.join(FRONTEND_DIR, "index.html"));

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
  if (!HAS_FRONTEND_DIR) {
    assert.ok(true, "Backend-only checkout does not ship the frontend directory.");
    return;
  }

  for (const relativePath of REQUIRED_FRONTEND_FILES) {
    const absolutePath = path.join(FRONTEND_DIR, relativePath);
    assert.ok(fs.existsSync(absolutePath), `Missing frontend file: ${relativePath}`);
  }
});

test("games page ships a search box for the dynamic catalog", () => {
  if (!HAS_FRONTEND_DIR) {
    assert.ok(true, "Backend-only checkout does not ship the frontend directory.");
    return;
  }

  const gamesPage = fs.readFileSync(path.join(FRONTEND_DIR, "games.html"), "utf8");
  assert.match(gamesPage, /games-search-input/);
  assert.match(gamesPage, /Search games, authors, or categories/);
});

test("frontend directory keeps shared images available for the static host", () => {
  if (HAS_FRONTEND_DIR) {
    assert.ok(fs.existsSync(path.join(FRONTEND_DIR, "images", "favicon.png")));
    assert.ok(fs.existsSync(path.join(FRONTEND_DIR, "images", "discord.png")));
    assert.ok(!fs.existsSync(path.join(FRONTEND_DIR, "images", "game-img")));
  }
  assert.ok(fs.existsSync(path.join(BACKEND_DIR, "images", "game-img")));
});

test("repo root no longer needs duplicate static page copies", () => {
  if (HAS_BACKEND_ONLY_LAYOUT) {
    assert.ok(fs.existsSync(path.join(REPO_DIR, "apps.js")));
    return;
  }

  assert.ok(!fs.existsSync(path.join(REPO_DIR, "index.html")));
  assert.ok(!fs.existsSync(path.join(REPO_DIR, "styles.css")));
  assert.ok(!fs.existsSync(path.join(REPO_DIR, "images")));
});

test("backend ships a Ruffle launcher for SWF games", () => {
  const launcherPath = path.join(BACKEND_DIR, "games", "swf", "chibi-knight.html");
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /@ruffle-rs\/ruffle/);
  assert.match(source, /\/swf\/chibi-knight\.swf/);
});

test("backend ships a Ruffle launcher for Super Chibi Knight", () => {
  const launcherPath = path.join(BACKEND_DIR, "games", "swf", "super-chibi-knight.html");
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /@ruffle-rs\/ruffle/);
  assert.match(source, /\/swf\/super-chibi-knight\.swf/);
});

test("backend ships a Ruffle launcher for The Impossible Quiz", () => {
  const launcherPath = path.join(BACKEND_DIR, "games", "swf", "the-impossible-quiz.html");
  const source = fs.readFileSync(launcherPath, "utf8");
  assert.match(source, /@ruffle-rs\/ruffle/);
  assert.match(source, /\/swf\/impossible-quiz\.swf/);
});

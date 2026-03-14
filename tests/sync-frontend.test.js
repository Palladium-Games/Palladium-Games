const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATIC_DIRS,
  STATIC_FILES,
  buildFrontendReadme,
  getFrontendCopyPlan
} = require("../scripts/sync-frontend.js");

test("frontend export includes the core static UI entrypoints", () => {
  const requiredFiles = [
    "index.html",
    "games.html",
    "game-player.html",
    "proxy.html",
    "ai.html",
    "music.html",
    "discord.html",
    "settings.html",
    "styles.css",
    "backend.js"
  ];

  for (const file of requiredFiles) {
    assert.ok(STATIC_FILES.includes(file), `Expected ${file} in frontend export`);
  }
});

test("frontend export keeps backend-only content out of the static deploy folder", () => {
  assert.ok(!STATIC_DIRS.includes("games"), "games should stay backend-hosted");
  assert.ok(!STATIC_DIRS.includes("discord-bots"), "discord bots must never ship to frontend");
  assert.ok(!STATIC_DIRS.includes("config"), "config must never ship to frontend");
});

test("frontend README points static hosts at the backend origin", () => {
  const readme = buildFrontendReadme();
  assert.match(readme, /api\.sethpang\.com/);
  assert.match(readme, /static frontend export/i);
});

test("frontend copy plan resolves all configured static files", () => {
  const plan = getFrontendCopyPlan();
  assert.equal(plan.files.length, STATIC_FILES.length);
  assert.equal(plan.directories.length, STATIC_DIRS.length);
  assert.ok(plan.files.every((entry) => entry.relativePath && entry.source && entry.destination));
});

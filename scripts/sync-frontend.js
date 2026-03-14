#!/usr/bin/env node

const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");

const STATIC_FILES = [
  "ai.html",
  "backend.js",
  "discord.html",
  "favicon.ico",
  "game-player.html",
  "games.html",
  "index.html",
  "music.html",
  "nav.js",
  "proxy.html",
  "settings.html",
  "site-settings.js",
  "styles.css"
];

const STATIC_DIRS = ["images"];

function getFrontendCopyPlan() {
  const files = STATIC_FILES.map((relativePath) => ({
    type: "file",
    source: path.join(ROOT_DIR, relativePath),
    destination: path.join(FRONTEND_DIR, relativePath),
    relativePath
  }));

  const directories = STATIC_DIRS.map((relativePath) => ({
    type: "dir",
    source: path.join(ROOT_DIR, relativePath),
    destination: path.join(FRONTEND_DIR, relativePath),
    relativePath
  }));

  return { files, directories };
}

function buildFrontendReadme() {
  return `# Palladium Frontend

This folder is the static frontend export for Palladium Games.

What lives here:

- HTML pages for the UI
- shared CSS and client-side JavaScript
- static images and favicon assets

What does not live here:

- AI runtime
- game files
- proxy/network runtime
- Monochrome hosting
- Discord bots

Deploy target:

- Host this folder on Netlify, Vercel, GitHub Pages, or any static host
- Point the UI at \`https://api.sethpang.com\` for backend APIs and hosted game files

Notes:

- \`game-player.html\` loads game files from the backend origin
- \`ai.html\`, \`proxy.html\`, \`discord.html\`, and \`games.html\` call backend APIs through \`backend.js\`
- Local development still works against the monolith on \`localhost\`
`;
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

async function copyFile(source, destination) {
  await ensureDirectory(destination);
  await fs.copyFile(source, destination);
}

async function copyDirectory(source, destination) {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
}

async function writeGeneratedFiles() {
  const readmePath = path.join(FRONTEND_DIR, "README.md");
  await ensureDirectory(readmePath);
  await fs.writeFile(readmePath, buildFrontendReadme(), "utf8");
}

async function syncFrontend() {
  const { files, directories } = getFrontendCopyPlan();

  await fs.mkdir(FRONTEND_DIR, { recursive: true });

  for (const entry of files) {
    await copyFile(entry.source, entry.destination);
  }

  for (const entry of directories) {
    await copyDirectory(entry.source, entry.destination);
  }

  await writeGeneratedFiles();
}

async function main() {
  await syncFrontend();
  console.log(`Frontend export synced to ${FRONTEND_DIR}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to sync frontend export:", error);
    process.exitCode = 1;
  });
}

module.exports = {
  FRONTEND_DIR,
  STATIC_DIRS,
  STATIC_FILES,
  buildFrontendReadme,
  getFrontendCopyPlan,
  syncFrontend
};

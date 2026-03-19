#!/usr/bin/env node

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const FRONTEND_DIR = path.resolve(__dirname, "..");
const ASSET_TARGETS = [
  {
    sourcePath: path.join("node_modules", "@mercuryworkshop", "scramjet", "dist", "scramjet.all.js"),
    targetPath: path.join(FRONTEND_DIR, "scram", "scramjet.all.js")
  },
  {
    sourcePath: path.join("node_modules", "@mercuryworkshop", "scramjet", "dist", "scramjet.sync.js"),
    targetPath: path.join(FRONTEND_DIR, "scram", "scramjet.sync.js")
  },
  {
    sourcePath: path.join("node_modules", "@mercuryworkshop", "scramjet", "dist", "scramjet.wasm.wasm"),
    targetPath: path.join(FRONTEND_DIR, "scram", "scramjet.wasm.wasm")
  },
  {
    sourcePath: path.join("node_modules", "@mercuryworkshop", "bare-mux", "dist", "index.js"),
    targetPath: path.join(FRONTEND_DIR, "baremux", "index.js")
  },
  {
    sourcePath: path.join("node_modules", "@mercuryworkshop", "bare-mux", "dist", "worker.js"),
    targetPath: path.join(FRONTEND_DIR, "baremux", "worker.js")
  },
  {
    sourcePath: path.join("node_modules", "@mercuryworkshop", "libcurl-transport", "dist", "index.mjs"),
    targetPath: path.join(FRONTEND_DIR, "libcurl", "index.mjs")
  }
];

async function main() {
  const backendDir = resolveBackendDir();

  for (const target of ASSET_TARGETS) {
    const sourcePath = path.join(backendDir, target.sourcePath);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Missing proxy asset ${sourcePath}. Run npm install in ${backendDir} before syncing frontend proxy assets.`
      );
    }

    await fsp.mkdir(path.dirname(target.targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, target.targetPath);
  }

  console.log("Synced %d Scramjet proxy assets from %s", ASSET_TARGETS.length, backendDir);
}

function resolveBackendDir() {
  const candidates = [
    path.resolve(FRONTEND_DIR, "..", "palladium-backend"),
    path.resolve(FRONTEND_DIR, "..", "backend")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "apps.js"))) {
      return candidate;
    }
  }

  throw new Error(
    "Could not find a sibling backend checkout. Expected apps.js under ../palladium-backend or ../backend."
  );
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const backendDir = path.resolve(__dirname, "..");
const optionalFrontendDir = path.resolve(backendDir, "..", "frontend");
const filesToCheck = [
  path.join(backendDir, "apps.js"),
  path.join(backendDir, "server.js")
];

if (fs.existsSync(path.join(optionalFrontendDir, "backend.js"))) {
  filesToCheck.push(
    path.join(optionalFrontendDir, "backend.js"),
    path.join(optionalFrontendDir, "nav.js"),
    path.join(optionalFrontendDir, "site-settings.js")
  );
}

for (const filePath of filesToCheck) {
  execFileSync(process.execPath, ["--check", filePath], {
    cwd: backendDir,
    stdio: "inherit"
  });
}

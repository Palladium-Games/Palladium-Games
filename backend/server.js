#!/usr/bin/env node

const path = require("node:path");

process.chdir(path.resolve(__dirname, ".."));
require(path.resolve(__dirname, "..", "apps.js"));

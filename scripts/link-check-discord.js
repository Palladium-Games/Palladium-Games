#!/usr/bin/env node

const APPS_BASE = (process.env.PALLADIUM_APPS_URL || "http://localhost:1338").replace(/\/$/, "");
const rawUrl = process.argv[2] || "";

if (!rawUrl.trim()) {
  console.error("Usage: node scripts/link-check-discord.js <url>");
  process.exit(1);
}

const endpoint = `${APPS_BASE}/link-check-discord?url=${encodeURIComponent(rawUrl)}`;

async function main() {
  const response = await fetch(endpoint, { method: "GET" });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // Keep payload empty and fail below.
  }

  if (!response.ok || !payload || payload.ok !== true) {
    const message = payload && payload.error ? payload.error : `HTTP ${response.status}`;
    throw new Error(`Link-check bot call failed: ${message}`);
  }

  const verdict = payload.result && payload.result.summary ? payload.result.summary.text : "No summary.";
  console.log(`Discord sent: ${payload.sent ? "yes" : "no"}`);
  console.log(`Webhook configured: ${payload.webhookConfigured ? "yes" : "no"}`);
  console.log(`Result: ${verdict}`);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});

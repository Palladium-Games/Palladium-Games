#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WEBHOOK_URL="${1:-}"
GITHUB_USERNAME_VALUE="${2:-}"

if [[ -n "$WEBHOOK_URL" ]]; then
  git config discord.webhookUrl "$WEBHOOK_URL"
  echo "Saved webhook URL to local git config: discord.webhookUrl"
fi

if [[ -n "$GITHUB_USERNAME_VALUE" ]]; then
  git config github.username "$GITHUB_USERNAME_VALUE"
  echo "Saved GitHub username to local git config: github.username"
fi

HOOK_FILE="$REPO_ROOT/.git/hooks/post-commit"
cat >"$HOOK_FILE" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$REPO_ROOT" ]]; then
  exit 0
fi

WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-$(git config --get discord.webhookUrl || true)}"
BOT_TOKEN="${DISCORD_BOT_TOKEN:-$(git config --get discord.botToken || true)}"
COMMIT_CHANNEL_ID="${DISCORD_COMMIT_CHANNEL_ID:-$(git config --get discord.commitChannelId || true)}"

if [[ -z "$WEBHOOK_URL" && ( -z "$BOT_TOKEN" || -z "$COMMIT_CHANNEL_ID" ) ]]; then
  exit 0
fi

node "$REPO_ROOT/scripts/discord-commit-notifier.js" "$WEBHOOK_URL" >/tmp/palladium-discord-hook.log 2>&1 || true
HOOK

chmod +x "$HOOK_FILE"

echo "Installed .git/hooks/post-commit"
echo "Usage:"
echo "  Bot mode (recommended):"
echo "    git config discord.botToken \"YOUR_BOT_TOKEN\""
echo "    git config discord.commitChannelId \"CHANNEL_ID\""
echo "  Webhook fallback:"
echo "    git config discord.webhookUrl \"https://discord.com/api/webhooks/...\""
echo "  Optional username override:"
echo "    git config github.username \"your-github-username\""
echo "  Commit as usual; notifications post automatically."

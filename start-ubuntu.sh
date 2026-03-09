#!/usr/bin/env bash
# PALLADIUM Ubuntu start: run Ollama, proxy/apps services, Discord bots, and site server.
# Run from project root: ./start-ubuntu.sh
# Stop with Ctrl+C; background processes started by this script are killed on exit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

TARGET_MODEL="${TARGET_MODEL:-qwen3.5:0.8b}"
FALLBACK_MODEL="${FALLBACK_MODEL:-qwen3.5:0.8b}"

SITE_HOST="${SITE_HOST:-0.0.0.0}"
SITE_PORT="${SITE_PORT:-3000}"
PROXY_HOST="${PALLADIUM_PROXY_HOST:-0.0.0.0}"
PROXY_PORT="${PALLADIUM_PROXY_PORT:-1337}"
APPS_HOST="${PALLADIUM_APPS_HOST:-0.0.0.0}"
APPS_PORT="${PALLADIUM_APPS_PORT:-1338}"

OLLAMA_PID=""
PROXY_PID=""
APPS_PID=""
COMMIT_PRESENCE_PID=""
LINK_COMMAND_BOT_PID=""
COMMUNITY_BOT_PID=""
SITE_PID=""

model_exists() {
  local model="$1"
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$model"
}

read_git_config() {
  local key="$1"
  git config --get "$key" 2>/dev/null | tr -d "\r" || true
}

first_ipv4() {
  hostname -I 2>/dev/null | awk '{print $1}' || true
}

cleanup() {
  echo ""
  echo "Shutting down..."
  if [[ -n "$SITE_PID" ]] && kill -0 "$SITE_PID" 2>/dev/null; then
    kill "$SITE_PID" 2>/dev/null || true
    echo "  Web server stopped."
  fi
  if [[ -n "$COMMUNITY_BOT_PID" ]] && kill -0 "$COMMUNITY_BOT_PID" 2>/dev/null; then
    kill "$COMMUNITY_BOT_PID" 2>/dev/null || true
    echo "  Community bot stopped."
  fi
  if [[ -n "$COMMIT_PRESENCE_PID" ]] && kill -0 "$COMMIT_PRESENCE_PID" 2>/dev/null; then
    kill "$COMMIT_PRESENCE_PID" 2>/dev/null || true
    echo "  Commit presence bot stopped."
  fi
  if [[ -n "$LINK_COMMAND_BOT_PID" ]] && kill -0 "$LINK_COMMAND_BOT_PID" 2>/dev/null; then
    kill "$LINK_COMMAND_BOT_PID" 2>/dev/null || true
    echo "  Link command bot stopped."
  fi
  if [[ -n "$APPS_PID" ]] && kill -0 "$APPS_PID" 2>/dev/null; then
    kill "$APPS_PID" 2>/dev/null || true
    echo "  Palladium apps stopped."
  fi
  if [[ -n "$PROXY_PID" ]] && kill -0 "$PROXY_PID" 2>/dev/null; then
    kill "$PROXY_PID" 2>/dev/null || true
    echo "  Palladium proxy stopped."
  fi
  if [[ -n "$OLLAMA_PID" ]] && kill -0 "$OLLAMA_PID" 2>/dev/null; then
    kill "$OLLAMA_PID" 2>/dev/null || true
    echo "  Ollama (started by this script) stopped."
  fi
  exit 0
}
trap cleanup INT TERM

echo "=== Ubuntu Setup ==="

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama not found."
  echo "Install on Ubuntu with: curl -fsSL https://ollama.com/install.sh | sh"
  echo "Then run ./start-ubuntu.sh again."
  exit 1
fi

if ! curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:11434/api/tags 2>/dev/null | grep -q 200; then
  echo "Starting Ollama..."
  ollama serve >/tmp/palladium-ollama.log 2>&1 &
  OLLAMA_PID=$!
  sleep 2
  if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
    echo "Ollama failed to start. Try: ollama serve"
    exit 1
  fi
  echo "Ollama started (PID $OLLAMA_PID)."
else
  echo "Ollama already running."
fi

if model_exists "$TARGET_MODEL"; then
  echo "Model $TARGET_MODEL present."
else
  echo "Pulling model $TARGET_MODEL (may take a few minutes)..."
  if ! ollama pull "$TARGET_MODEL"; then
    echo "Failed to pull $TARGET_MODEL, trying fallback $FALLBACK_MODEL ..."
    ollama pull "$FALLBACK_MODEL"
    if ! model_exists "$TARGET_MODEL"; then
      if ollama cp "$FALLBACK_MODEL" "$TARGET_MODEL" >/tmp/palladium-ollama-cp.log 2>&1; then
        echo "Created alias $TARGET_MODEL -> $FALLBACK_MODEL"
      else
        echo "Warning: could not create alias $TARGET_MODEL."
        echo "Set CHATBOT_MODEL in chatbot-config.js to $FALLBACK_MODEL if chat fails to load."
      fi
    fi
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found."
  echo "Install on Ubuntu (apt): sudo apt update && sudo apt install -y nodejs npm"
  echo "Or install with nvm for newer Node versions."
  exit 1
fi

if [[ ! -f "$REPO_ROOT/palladium-proxy.js" ]]; then
  echo "Missing palladium-proxy.js in project root."
  exit 1
fi

if [[ ! -f "$REPO_ROOT/apps.js" ]]; then
  echo "Missing apps.js in project root."
  exit 1
fi

echo "Starting Palladium proxy on http://127.0.0.1:${PROXY_PORT} ..."
HOST="$PROXY_HOST" PORT="$PROXY_PORT" node "$REPO_ROOT/palladium-proxy.js" >/tmp/palladium-proxy.log 2>&1 &
PROXY_PID=$!
sleep 1
if kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "Palladium proxy started (PID $PROXY_PID)."
else
  PROXY_PID=""
  echo "Palladium proxy failed to start. See /tmp/palladium-proxy.log"
fi

echo "Starting Palladium apps on http://127.0.0.1:${APPS_PORT} ..."
APPS_HOST="$APPS_HOST" APPS_PORT="$APPS_PORT" node "$REPO_ROOT/apps.js" >/tmp/palladium-apps.log 2>&1 &
APPS_PID=$!
sleep 1
if kill -0 "$APPS_PID" 2>/dev/null; then
  echo "Palladium apps started (PID $APPS_PID)."
else
  APPS_PID=""
  echo "Palladium apps failed to start. See /tmp/palladium-apps.log"
fi

GLOBAL_BOT_TOKEN_VALUE="${DISCORD_BOT_TOKEN:-$(read_git_config discord.botToken)}"
COMMIT_BOT_TOKEN_VALUE="${DISCORD_COMMIT_BOT_TOKEN:-$(read_git_config discord.commitBotToken)}"
if [[ -z "$COMMIT_BOT_TOKEN_VALUE" ]]; then
  COMMIT_BOT_TOKEN_VALUE="$GLOBAL_BOT_TOKEN_VALUE"
fi

if [[ -f "$REPO_ROOT/scripts/discord-commit-presence.js" && -n "$COMMIT_BOT_TOKEN_VALUE" ]]; then
  echo "Starting commit presence bot ..."
  DISCORD_COMMIT_BOT_TOKEN="$COMMIT_BOT_TOKEN_VALUE" \
  node "$REPO_ROOT/scripts/discord-commit-presence.js" >/tmp/palladium-commit-presence.log 2>&1 &
  COMMIT_PRESENCE_PID=$!
  sleep 1
  if kill -0 "$COMMIT_PRESENCE_PID" 2>/dev/null; then
    echo "Commit presence bot started (PID $COMMIT_PRESENCE_PID)."
  else
    COMMIT_PRESENCE_PID=""
    echo "Commit presence bot failed to start. See /tmp/palladium-commit-presence.log"
  fi
else
  echo "Commit presence bot not started (set discord.commitBotToken)."
fi

LINK_BOT_TOKEN_VALUE="${DISCORD_LINK_BOT_TOKEN:-$(read_git_config discord.linkBotToken)}"
if [[ -z "$LINK_BOT_TOKEN_VALUE" ]]; then
  LINK_BOT_TOKEN_VALUE="$GLOBAL_BOT_TOKEN_VALUE"
fi

LINK_CMD_CHANNELS_VALUE="${DISCORD_LINK_COMMAND_CHANNEL_IDS:-$(read_git_config discord.linkCommandChannelIds)}"
if [[ -z "$LINK_CMD_CHANNELS_VALUE" ]]; then
  LINK_CMD_CHANNELS_VALUE="$(read_git_config discord.linkCheckerChannelId)"
fi

if [[ -f "$REPO_ROOT/scripts/discord-link-command-bot.js" && -n "$LINK_BOT_TOKEN_VALUE" && -n "$LINK_CMD_CHANNELS_VALUE" ]]; then
  echo "Starting link command bot ..."
  DISCORD_BOT_TOKEN="$LINK_BOT_TOKEN_VALUE" \
  DISCORD_LINK_COMMAND_CHANNEL_IDS="$LINK_CMD_CHANNELS_VALUE" \
  node "$REPO_ROOT/scripts/discord-link-command-bot.js" >/tmp/palladium-link-command-bot.log 2>&1 &
  LINK_COMMAND_BOT_PID=$!
  sleep 1
  if kill -0 "$LINK_COMMAND_BOT_PID" 2>/dev/null; then
    echo "Link command bot started (PID $LINK_COMMAND_BOT_PID)."
  else
    LINK_COMMAND_BOT_PID=""
    echo "Link command bot failed to start. See /tmp/palladium-link-command-bot.log"
  fi
else
  echo "Link command bot not started (set discord.linkBotToken + discord.linkCommandChannelIds)."
fi

COMMUNITY_BOT_TOKEN_VALUE="${DISCORD_COMMUNITY_BOT_TOKEN:-$(read_git_config discord.communityBotToken)}"
if [[ -z "$COMMUNITY_BOT_TOKEN_VALUE" ]]; then
  COMMUNITY_BOT_TOKEN_VALUE="$GLOBAL_BOT_TOKEN_VALUE"
fi
WELCOME_CHANNEL_VALUE="${DISCORD_WELCOME_CHANNEL_ID:-$(read_git_config discord.welcomeChannelId)}"
RULES_CHANNEL_VALUE="${DISCORD_RULES_CHANNEL_ID:-$(read_git_config discord.rulesChannelId)}"

if [[ -f "$REPO_ROOT/scripts/discord-community-bot.js" && -n "$COMMUNITY_BOT_TOKEN_VALUE" && -n "$WELCOME_CHANNEL_VALUE" && -n "$RULES_CHANNEL_VALUE" ]]; then
  echo "Starting community bot ..."
  DISCORD_COMMUNITY_BOT_TOKEN="$COMMUNITY_BOT_TOKEN_VALUE" \
  DISCORD_WELCOME_CHANNEL_ID="$WELCOME_CHANNEL_VALUE" \
  DISCORD_RULES_CHANNEL_ID="$RULES_CHANNEL_VALUE" \
  node "$REPO_ROOT/scripts/discord-community-bot.js" >/tmp/palladium-community-bot.log 2>&1 &
  COMMUNITY_BOT_PID=$!
  sleep 1
  if kill -0 "$COMMUNITY_BOT_PID" 2>/dev/null; then
    echo "Community bot started (PID $COMMUNITY_BOT_PID)."
  else
    COMMUNITY_BOT_PID=""
    echo "Community bot failed to start. See /tmp/palladium-community-bot.log"
  fi
else
  echo "Community bot not started (set community bot token + welcome/rules channels)."
fi

PUBLIC_IP="$(first_ipv4)"

echo ""
echo "=== Running site ==="
echo "  Site:   http://127.0.0.1:${SITE_PORT}"
if [[ -n "$PUBLIC_IP" ]]; then
  echo "  Site:   http://${PUBLIC_IP}:${SITE_PORT}"
fi
echo "  AI:     http://127.0.0.1:11434 (Ollama)"
echo "  Proxy:  http://127.0.0.1:${PROXY_PORT} (Palladium Browse)"
echo "  Apps:   http://127.0.0.1:${APPS_PORT} (Palladium Links + Ollama proxy)"
if [[ -n "$COMMIT_PRESENCE_PID" ]]; then
  echo "  Bot:    Commit presence bot running"
fi
if [[ -n "$LINK_COMMAND_BOT_PID" ]]; then
  echo "  Bot:    Link command bot running"
fi
if [[ -n "$COMMUNITY_BOT_PID" ]]; then
  echo "  Bot:    Community bot running"
fi
echo ""
echo "Press Ctrl+C to stop the site and any services started by this script."
echo ""

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$SITE_PORT" --bind "$SITE_HOST" >/tmp/palladium-site.log 2>&1 &
  SITE_PID=$!
else
  npx serve -l "tcp://${SITE_HOST}:${SITE_PORT}" . >/tmp/palladium-site.log 2>&1 &
  SITE_PID=$!
fi

wait "$SITE_PID"

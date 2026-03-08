#!/usr/bin/env bash
# PALLADIUM start: setup once (Ollama), then run Ollama, local services, and optional Discord bots.
# Run from project root: ./start.sh
# Stop with Ctrl+C; background processes started by this script are killed on exit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

TARGET_MODEL="${TARGET_MODEL:-qwen3.5:0.8b}"
FALLBACK_MODEL="${FALLBACK_MODEL:-qwen3.5:0.8b}"

OLLAMA_PID=""
PROXY_PID=""
APPS_PID=""
LINK_COMMAND_BOT_PID=""
COMMUNITY_BOT_PID=""

model_exists() {
  local model="$1"
  ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -Fxq "$model"
}

read_git_config() {
  local key="$1"
  git config --get "$key" 2>/dev/null || true
}

cleanup() {
  echo ""
  echo "Shutting down..."
  if [[ -n "$COMMUNITY_BOT_PID" ]] && kill -0 "$COMMUNITY_BOT_PID" 2>/dev/null; then
    kill "$COMMUNITY_BOT_PID" 2>/dev/null || true
    echo "  Community bot stopped."
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

echo "=== Setup ==="

if ! command -v ollama &>/dev/null; then
  echo "Ollama not found. Install from https://ollama.com or run: brew install ollama"
  echo "Then run ./start.sh again."
  exit 1
fi

if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q 200; then
  echo "Starting Ollama..."
  ollama serve &>/dev/null &
  OLLAMA_PID=$!
  sleep 2
  if ! kill -0 "$OLLAMA_PID" 2>/dev/null; then
    echo "Ollama failed to start. Try running 'ollama serve' in another terminal."
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

if ! command -v node &>/dev/null; then
  echo "Node.js not found. Install Node to run local Palladium services."
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

echo "Starting Palladium proxy on http://localhost:1337 ..."
node "$REPO_ROOT/palladium-proxy.js" &>/dev/null &
PROXY_PID=$!
sleep 1
if kill -0 "$PROXY_PID" 2>/dev/null; then
  echo "Palladium proxy started (PID $PROXY_PID)."
else
  PROXY_PID=""
  echo "Palladium proxy failed to start. Run manually: node palladium-proxy.js"
fi

echo "Starting Palladium apps on http://localhost:1338 ..."
node "$REPO_ROOT/apps.js" &>/dev/null &
APPS_PID=$!
sleep 1
if kill -0 "$APPS_PID" 2>/dev/null; then
  echo "Palladium apps started (PID $APPS_PID)."
else
  APPS_PID=""
  echo "Palladium apps failed to start. Run manually: node apps.js"
fi

BOT_TOKEN_VALUE="${DISCORD_BOT_TOKEN:-$(read_git_config discord.botToken)}"
LINK_CMD_CHANNELS_VALUE="${DISCORD_LINK_COMMAND_CHANNEL_IDS:-$(read_git_config discord.linkCommandChannelIds)}"
if [[ -z "$LINK_CMD_CHANNELS_VALUE" ]]; then
  LINK_CMD_CHANNELS_VALUE="$(read_git_config discord.linkCheckerChannelId)"
fi

if [[ -f "$REPO_ROOT/scripts/discord-link-command-bot.js" && -n "$BOT_TOKEN_VALUE" && -n "$LINK_CMD_CHANNELS_VALUE" ]]; then
  echo "Starting link command bot ..."
  DISCORD_BOT_TOKEN="$BOT_TOKEN_VALUE" \
  DISCORD_LINK_COMMAND_CHANNEL_IDS="$LINK_CMD_CHANNELS_VALUE" \
  node "$REPO_ROOT/scripts/discord-link-command-bot.js" &>/tmp/palladium-link-command-bot.log &
  LINK_COMMAND_BOT_PID=$!
  sleep 1
  if kill -0 "$LINK_COMMAND_BOT_PID" 2>/dev/null; then
    echo "Link command bot started (PID $LINK_COMMAND_BOT_PID)."
  else
    LINK_COMMAND_BOT_PID=""
    echo "Link command bot failed to start. See /tmp/palladium-link-command-bot.log"
  fi
else
  echo "Link command bot not started (set discord.botToken + discord.linkCommandChannelIds)."
fi

COMMUNITY_BOT_TOKEN_VALUE="${DISCORD_COMMUNITY_BOT_TOKEN:-$(read_git_config discord.communityBotToken)}"
if [[ -z "$COMMUNITY_BOT_TOKEN_VALUE" ]]; then
  COMMUNITY_BOT_TOKEN_VALUE="$BOT_TOKEN_VALUE"
fi
WELCOME_CHANNEL_VALUE="${DISCORD_WELCOME_CHANNEL_ID:-$(read_git_config discord.welcomeChannelId)}"
RULES_CHANNEL_VALUE="${DISCORD_RULES_CHANNEL_ID:-$(read_git_config discord.rulesChannelId)}"

if [[ -f "$REPO_ROOT/scripts/discord-community-bot.js" && -n "$COMMUNITY_BOT_TOKEN_VALUE" && -n "$WELCOME_CHANNEL_VALUE" && -n "$RULES_CHANNEL_VALUE" ]]; then
  echo "Starting community bot ..."
  DISCORD_COMMUNITY_BOT_TOKEN="$COMMUNITY_BOT_TOKEN_VALUE" \
  DISCORD_WELCOME_CHANNEL_ID="$WELCOME_CHANNEL_VALUE" \
  DISCORD_RULES_CHANNEL_ID="$RULES_CHANNEL_VALUE" \
  node "$REPO_ROOT/scripts/discord-community-bot.js" &>/tmp/palladium-community-bot.log &
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

echo ""
echo "=== Running site ==="
echo "  Site:   http://localhost:3000"
echo "  AI:     http://localhost:11434 (Ollama)"
echo "  Proxy:  http://localhost:1337 (Palladium Browse)"
echo "  Apps:   http://localhost:1338 (Palladium Links)"
if [[ -n "$LINK_COMMAND_BOT_PID" ]]; then
  echo "  Bot:    Link command bot running"
fi
if [[ -n "$COMMUNITY_BOT_PID" ]]; then
  echo "  Bot:    Community bot running"
fi
echo ""
echo "Press Ctrl+C to stop the site and any services started by this script."
echo ""

exec npx serve -l 3000 .

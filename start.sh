#!/usr/bin/env bash
# TITANIUM start: setup once (Ollama), then run Ollama, local proxy, and the site.
# Run from project root: ./start.sh
# Stop with Ctrl+C; background processes started by this script are killed on exit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

OLLAMA_PID=""
PROXY_PID=""

cleanup() {
  echo ""
  echo "Shutting down..."
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

if ! ollama list 2>/dev/null | grep -q "llama3.2"; then
  echo "Pulling model llama3.2 (may take a few minutes)..."
  ollama pull llama3.2
else
  echo "Model llama3.2 present."
fi

if ! command -v node &>/dev/null; then
  echo "Node.js not found. Install Node to run the local Palladium proxy."
  exit 1
fi

if [[ ! -f "$REPO_ROOT/palladium-proxy.js" ]]; then
  echo "Missing palladium-proxy.js in project root."
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

echo ""
echo "=== Running site ==="
echo "  Site:   http://localhost:3000"
echo "  AI:     http://localhost:11434 (Ollama)"
echo "  Proxy:  http://localhost:1337 (Palladium Browse)"
echo ""
echo "Press Ctrl+C to stop the site and any services started by this script."
echo ""

exec npx serve -l 3000 .

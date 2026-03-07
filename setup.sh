#!/usr/bin/env bash
# TITANIUM setup: install Ollama + optional Monochrome, hook up for PalladiumAI and Music tab.
# Run from project root: ./setup.sh

set -e
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

echo "=== Ollama (PalladiumAI) ==="

# Install Ollama if missing (macOS Homebrew)
if ! command -v ollama &>/dev/null; then
  if command -v brew &>/dev/null; then
    echo "Installing Ollama via Homebrew..."
    brew install ollama
  else
    echo "Ollama not found. Install from https://ollama.com or run: brew install ollama"
    exit 1
  fi
fi

# Ensure Ollama is running
if ! curl -s -o /dev/null -w "%{http_code}" http://localhost:11434/api/tags 2>/dev/null | grep -q 200; then
  echo "Ollama is not running. Start it in another terminal with: ollama serve"
  echo "Then run this script again, or press Enter to try pulling the model anyway (will start Ollama if possible)."
  read -r
  (ollama serve &) 2>/dev/null || true
  sleep 3
fi

echo "Pulling model llama3.2 (may take a few minutes)..."
ollama pull llama3.2

echo ""
echo "Ollama is ready. chatbot-config.js already points to http://localhost:11434 and model llama3.2."
echo ""

# Optional: Monochrome
echo "=== Monochrome (Music tab) ==="
MONO_DIR="$REPO_ROOT/monochrome"
if [[ -d "$MONO_DIR/.git" ]]; then
  echo "Monochrome already cloned at $MONO_DIR"
  read -p "Start with Docker? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    (cd "$MONO_DIR" && docker compose up -d) || echo "Docker not available or compose failed. Use https://monochrome.tf in music-config.js instead."
  fi
else
  read -p "Clone and start Monochrome with Docker? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if ! command -v docker &>/dev/null; then
      echo "Docker not found. Set MUSIC_URL to https://monochrome.tf in music-config.js to use the public instance."
    else
      git clone --depth 1 https://github.com/monochrome-music/monochrome.git "$MONO_DIR"
      (cd "$MONO_DIR" && docker compose up -d) || echo "docker compose failed. Try: cd monochrome && docker compose up -d"
      echo "If Monochrome started, set in music-config.js: var MUSIC_URL = 'http://localhost:3000';"
    fi
  else
    echo "Using public instance: music-config.js already has MUSIC_URL = 'https://monochrome.tf'"
  fi
fi

echo ""
echo "Done. Open the AI Chatbot tab for PalladiumAI and the Music tab for Monochrome."

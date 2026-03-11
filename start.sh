#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "config/palladium.env" ]]; then
  mkdir -p config
  cp config/palladium.env.example config/palladium.env
  echo "Created config/palladium.env from template. Fill in tokens and settings as needed."
fi

exec node apps.js

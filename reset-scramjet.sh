#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRAMJET_DIR="$REPO_ROOT/scramjet-repo"
SCRAMJET_RELEASE_URL="https://github.com/MercuryWorkshop/scramjet/releases/download/latest/mercuryworkshop-scramjet-2.0.0-alpha.tgz"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Resetting Scramjet in $SCRAMJET_DIR ..."
rm -rf "$SCRAMJET_DIR"
git clone --recursive https://github.com/MercuryWorkshop/scramjet.git "$SCRAMJET_DIR"

echo "Installing Scramjet dependencies ..."
(
  cd "$SCRAMJET_DIR"
  pnpm i
)

echo "Downloading prebuilt Scramjet dist bundle ..."
curl -L "$SCRAMJET_RELEASE_URL" -o "$TMP_DIR/scramjet-release.tgz"
tar -xzf "$TMP_DIR/scramjet-release.tgz" -C "$TMP_DIR"
rm -rf "$SCRAMJET_DIR/dist"
cp -R "$TMP_DIR/package/dist" "$SCRAMJET_DIR/dist"

cat <<'EOF'

Scramjet reset complete.

Start proxy:
  cd scramjet-repo
  CI=1 pnpm dev

Then open Browse over HTTP (not file://), for example:
  python3 -m http.server 3000
  http://localhost:3000/browse.html
EOF

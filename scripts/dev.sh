#!/usr/bin/env bash
# scripts/dev.sh — Start the LumenFlow frontend dev server with live reload.
set -euo pipefail

FRONTEND_DIR="$(cd "$(dirname "$0")/../frontend" && pwd)"

if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js is required. Install it from https://nodejs.org"
    exit 1
fi

cd "$FRONTEND_DIR"

if [[ ! -d node_modules ]]; then
    echo "==> Installing frontend dependencies..."
    npm install
fi

echo "==> Starting dev server (http://localhost:3000) with live reload..."
echo "    Edit files in frontend/ — the browser will refresh automatically."
echo "    Press Ctrl+C to stop."
echo ""
npm run dev

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3000}"
echo "Starting Mini Kart Racing on http://localhost:${PORT}"
exec node server.js

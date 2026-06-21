#!/usr/bin/env bash
# aigetwey — bring up gateway + dashboard with one command.
#   ./run.sh
# Built (production): npm run build && npm --prefix dashboard run build && ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

# zero-config local defaults (override by exporting before running).
export AIGETWEY_ADMIN_PASSWORD="${AIGETWEY_ADMIN_PASSWORD:-123456}"
# stable secret so the dashboard login cookie survives restarts.
export SESSION_SECRET="${SESSION_SECRET:-aigetwey-local-session-secret}"

# seed a working config.yaml on first run (gitignored; holds keys).
if [ ! -f config.yaml ]; then
  cp config.example.yaml config.yaml
  echo "  seeded config.yaml from the example — edit it to add providers."
fi

# one-time dependency install.
[ -d node_modules ] || npm install
[ -d dashboard/node_modules ] || npm install --prefix dashboard

if [ -f dist/cli.js ]; then
  exec node dist/cli.js
else
  exec npx tsx src/cli.ts
fi

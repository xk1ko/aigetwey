#!/usr/bin/env bash
# aigetwey — bring up gateway + dashboard with one command.
# Dev (live reload):  ./run.sh
# Built (production): npm run build && npm --prefix dashboard run build && ./run.sh
set -euo pipefail
cd "$(dirname "$0")"

if [ -f dist/cli.js ]; then
  exec node dist/cli.js
else
  exec npx tsx src/cli.ts
fi

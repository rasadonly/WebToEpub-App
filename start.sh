#!/bin/sh
# Boots Tor (optional), the Python stealth sidecar, then the Node API server.
set -e

if [ "${ENABLE_TOR:-1}" = "1" ] && command -v tor >/dev/null 2>&1; then
  echo "[boot] starting tor"
  tor --SocksPort 9050 --RunAsDaemon 1 --Log "notice stdout" || echo "[boot] tor failed to start (continuing)"
fi

if command -v python3 >/dev/null 2>&1; then
  echo "[boot] starting stealth sidecar"
  python3 /app/src/stealth.py &
fi

exec node src/index.js

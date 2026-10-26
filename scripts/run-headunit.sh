#!/usr/bin/env bash
# Local demo: a virtual head unit on HU-2.3.1 doing cold boots at -8 °C, watched by hu-sentinel.
set -euo pipefail
cd "$(dirname "$0")/.."
TEMP="${TEMP:--8}"
INTERVAL="${INTERVAL:-20}"

mkdir -p .hu/system
if [ ! -d .hu/system/media-service ] || [ "${RESET:-0}" = "1" ]; then
  rm -rf .hu/system/media-service .hu/system/media-service.bak .hu/logcat.log .hu/spool
  cp -r media-service .hu/system/media-service   # factory image: the buggy 2.3.1 build
fi
[ -f hu-sentinel.json ] || cp hu-sentinel/config.example.json hu-sentinel.json
[ -x hu-sentinel/bin/hu-sentinel ] || { echo "build hu-sentinel first (see hu-sentinel/README.md)"; exit 1; }

hu-sentinel/bin/hu-sentinel --config hu-sentinel.json &
SENTINEL=$!
trap 'kill $SENTINEL 2>/dev/null' EXIT
sleep 1
.venv/bin/python sim/headunit.py --service-path .hu/system/media-service --temp "$TEMP" --out .hu/logcat.log --interval "$INTERVAL"

#!/usr/bin/env bash
# One-time local setup: Python venv, frontend build, hu-sentinel build (via Docker if Go is not installed).
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
.venv/bin/pip install -q -r backend/requirements.txt
(cd frontend && npm ci && npm run build)
if command -v go >/dev/null; then
  (cd hu-sentinel && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/hu-sentinel ./cmd/hu-sentinel)
else
  docker run --rm --user "$(id -u):$(id -g)" -e GOCACHE=/tmp/gocache -e HOME=/tmp -v "$PWD":/src -w /src/hu-sentinel \
    golang:1.23-alpine sh -c 'CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/hu-sentinel ./cmd/hu-sentinel'
fi
echo "setup complete: run scripts/console.sh, then scripts/run-headunit.sh"

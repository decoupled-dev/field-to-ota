#!/usr/bin/env bash
# Start the console (API + built frontend) on :8000. F2F_DEMO_PACE slows agent steps for live demos (1.0 = presenter pace).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
exec .venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port "${PORT:-8000}"

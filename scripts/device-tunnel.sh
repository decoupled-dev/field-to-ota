#!/usr/bin/env bash
# Connects the Android VM on the vSkipGen host to this console without opening inbound ports:
#   VM localhost:8000 --adb reverse--> vSkipGen localhost:18000 --ssh -R--> this host 127.0.0.1:8000
# One SSH session holds the reverse tunnel and re-applies `adb reverse` every 30 s
# (it is lost whenever the VM or adbd restarts). systemd restarts this script if SSH drops.
set -euo pipefail
: "${DEVICE_SSH_HOST:?}" "${DEVICE_SSH_KEY:?}"
SERIAL="${DEVICE_ADB_SERIAL:-0.0.0.0:6520}"
LOCAL_PORT="${PORT:-8000}"
REMOTE_PORT="${DEVICE_TUNNEL_PORT:-18000}"
exec ssh -i "$DEVICE_SSH_KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
  -R "127.0.0.1:${REMOTE_PORT}:127.0.0.1:${LOCAL_PORT}" "$DEVICE_SSH_HOST" \
  "while true; do adb -s '$SERIAL' reverse tcp:${LOCAL_PORT} tcp:${REMOTE_PORT} >/dev/null 2>&1 || true; sleep 30; done"

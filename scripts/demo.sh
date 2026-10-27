#!/usr/bin/env bash
# Demo helper for the issue-daemon → case → fix → OTA loop.
#   scripts/demo.sh reset     build the buggy branch from device_apps.json and install it on the vehicle
#   scripts/demo.sh status    services, daemon upload state, app on the vehicle
#   scripts/demo.sh crash     shell-induced crash (fallback if nobody can tap +/- on the screen)
set -euo pipefail
cd "$(dirname "$0")/.."
CFG="${F2F_DEVICE_APPS_FILE:-$HOME/.config/field-to-ota/device_apps.json}"
PKG="${PKG:-com.test.design}"
eval "$(python3 - "$CFG" "$PKG" <<'PY'
import json, shlex, sys
a = json.load(open(sys.argv[1]))[sys.argv[2]]
d = a["device"]
for k, v in {"REPO": a.get("clone_url") or a["repo"], "BRANCH": a["branch"], "BUILD": a.get("build_command", "./gradlew :app:assembleDebug"),
             "APK": a.get("apk_path", "app/build/outputs/apk/debug/app-debug.apk"), "LAUNCH": a.get("launch", ""),
             "HOST": d["ssh_host"], "KEY": d["ssh_key"], "SERIAL": d["adb_serial"]}.items():
    print(f"{k}={shlex.quote(v)}")
PY
)"
ssh_() { ssh -i "$KEY" -o BatchMode=yes -o ConnectTimeout=15 "$HOST" "$@"; }
adb_() { ssh_ "adb -s $SERIAL $*"; }

case "${1:-status}" in
  reset)
    WT=.state/workspace/demo-baseline
    if [ -d "$WT/.git" ]; then git -C "$WT" fetch -q origin "$BRANCH" && git -C "$WT" checkout -q -B "$BRANCH" FETCH_HEAD
    else rm -rf "$WT"; git clone -q --branch "$BRANCH" "$REPO" "$WT"; fi
    echo ">> building $BRANCH @ $(git -C "$WT" rev-parse --short HEAD)"
    (cd "$WT" && ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}" $BUILD -q)
    scp -q -i "$KEY" -o BatchMode=yes "$WT/$APK" "$HOST:/tmp/demo-baseline.apk"
    adb_ install -r -t /tmp/demo-baseline.apk
    [ -n "$LAUNCH" ] && adb_ shell "$LAUNCH" >/dev/null
    echo ">> buggy build installed and launched. Press + or - on the Climate screen to crash it."
    ;;
  status)
    systemctl is-active field-to-ota f2f-device-tunnel | paste -sd' ' | sed 's/^/services: /'
    adb_ shell am broadcast --user 0 -n com.aaos.issuedaemon/.ControlReceiver -a com.aaos.issuedaemon.action.STATUS \
      | grep -E '"server_url"|"last_upload"|"queued_reports"' || echo "issue-daemon: no status"
    echo "app: pid=$(adb_ shell pidof "$PKG" || true) $(adb_ shell dumpsys package "$PKG" | grep -m1 lastUpdateTime | xargs)"
    ;;
  crash)
    adb_ shell am crash "$PKG"
    ;;
  *) echo "usage: $0 reset|status|crash"; exit 2 ;;
esac

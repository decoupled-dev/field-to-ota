# On-vehicle issue-daemon → case → fix → OTA

[issue-daemon](https://github.com/decoupled-dev/issue-daemon) runs on the AAOS head unit as a system-uid
service. When it detects a crash it posts a report here; a crash of a registered app opens a case and the
**Device Crash Agent** (`backend/app/agents/device_crash.py`) runs the V-cycle against that app's repo and
the test vehicle.

```
AAOS VM: issue-daemon ──POST /api/v1/issues──► localhost:8000 ─adb reverse─► vSkipGen host ─ssh -R─► console
                                                     (scripts/device-tunnel.sh, no inbound ports)
console: ingest → case → Device Crash Agent:
  detect · triage · ticket · fleet · reproduce (clone + unit tests) · rca (failing test → function → git log -L)
  · requirement (repo Markdown) · fix (external Fix agent, commit on fix/<case>-<fn>) · verify (tests + APK)
  · approve (human) · release (sign, scp, sha256 check, adb install) · monitor (process + new reports)
```

## Pieces

| File | What |
|---|---|
| `backend/app/issue_daemon.py` | `/api/v1/issues` (multipart `metadata` + zip `bundle`) and `/api/v1/heartbeat`. Optional `F2F_DEVICE_API_KEY` bearer check. Crashes (`APP_CRASH`, `NATIVE_CRASH`, `ANR`, `OUT_OF_MEMORY`) of a registered app open a case at once. |
| `backend/app/device_apps.py` | Registry of apps: package → repo, branch, test/build commands, device. File: `F2F_DEVICE_APPS_FILE` (example: `deploy/device_apps.example.json`). |
| `backend/app/agents/device_crash.py` | Stage handlers for those cases. `pipeline/runner.py:handler_for` picks them by `case.component`. |
| `scripts/device-tunnel.sh` | SSH reverse tunnel + `adb reverse`, re-applied every 30 s. |
| `deploy/systemd/*.service` | `field-to-ota.service` (console) and `f2f-device-tunnel.service`. |

## Deploy (Kiro EC2)

```bash
scripts/setup.sh                                   # venv + frontend build
mkdir -p ~/.config/field-to-ota && chmod 700 ~/.config/field-to-ota
cp deploy/device_apps.example.json ~/.config/field-to-ota/device_apps.json   # fill in device
echo "F2F_DEVICE_API_KEY=$(openssl rand -hex 24)" > ~/.config/field-to-ota/device_key.env; chmod 600 ~/.config/field-to-ota/*.env
cat > ~/.config/field-to-ota/field-to-ota.env <<'EOF'
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0
F2F_DEVICE_APPS_FILE=/home/ubuntu/.config/field-to-ota/device_apps.json
ANDROID_HOME=/home/ubuntu/android-sdk
HOST=127.0.0.1
PORT=8000
EOF
cat > ~/.config/field-to-ota/device-tunnel.env <<'EOF'
DEVICE_SSH_HOST=ubuntu@<vskipgen-host>
DEVICE_SSH_KEY=/home/ubuntu/.ssh/<team-key>.pem
DEVICE_ADB_SERIAL=0.0.0.0:6520
PORT=8000
DEVICE_TUNNEL_PORT=18000
EOF
sudo cp deploy/systemd/*.service /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl enable --now field-to-ota f2f-device-tunnel
```

Fix and verify run Gradle on this host: JDK 21 and the Android SDK (`ANDROID_HOME`) are required.

## Point the daemon at the console (adb on the vSkipGen host)

```bash
R="--user 0 -n com.aaos.issuedaemon/.ControlReceiver -a com.aaos.issuedaemon.action"
adb shell am broadcast $R.SET_SERVER_URL --es url http://127.0.0.1:8000
adb shell "am broadcast $R.SET_CONFIG --es json '{\"server\":{\"api_key\":\"<F2F_DEVICE_API_KEY>\"}}'"
adb shell am broadcast $R.STATUS        # last_upload: ok (HTTP 200)
```

## Test the cycle

```bash
adb install -r -t app-debug.apk         # demo-app @ climate-hvac-crash-demo
adb shell am start -n com.test.design/.MainActivity
adb shell am crash com.test.design      # issue-daemon reports APP_CRASH → case opens
```

The removed guard in `fanSpeedFromTrackPosition` gives a wrong value rather than a crash in normal UI use,
so the shell-induced crash stands in for the field crash; Reproduce and Root Cause use the failing unit test.
Fix branches are pushed to a local review remote (`.state/workspace/remote/<package>.git`).

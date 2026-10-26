# hu-sentinel

A lightweight head-unit health daemon. It is Field-to-Fix's in-vehicle intake (Flow B).

It follows the same flow as Android's **BugReport app / `dumpstate`**: something triggers capture, it collects a bundle (logs, system state, optional audio/screen) and uploads it. The difference is that the trigger is automatic: a **rule engine** watching the live log stream, instead of a driver pressing a button. The same daemon also receives the **signed OTA** that fixes the bug, and it reports post-fix health, so the loop closes on the vehicle.

```
logcat stream ──► collector.Tail ──► ringbuf (60 s) ─────────────┐
                        │                                        │
                        ├──► rules.Engine ──fire──► capture.Build (scrubbed tar.gz)
                        │       (regex × count/window,              │
                        │        all_of, cooldown)                  ▼
                        └──► health.Tracker ──► uplink.SendHealth   uplink.SendEvent ──fail──► queue (disk spool, size cap, backoff)
                                                                     
uplink.NextJob ──► ota.Updater: download → sha256 + ed25519 verify → extract → atomic swap (.bak kept) → SUCCEEDED/FAILED
```

## Packages
| Package | Role |
|---|---|
| `internal/collector` | `tail -F` of the log stream (handles rotation/truncation), plus a `/proc` CPU/mem sampler |
| `internal/ringbuf` | bounded, age-limited in-memory log buffer (default 4000 lines / 60 s) |
| `internal/rules` | streaming rule engine: regex conditions counted over sliding windows, `all_of` composites, cooldowns; per-condition memory is capped |
| `internal/capture` | builds the bundle: `logs_60s.txt`, `rule.json`, `device.json`, `proc.json`, optional audio/screen/tombstone, `manifest.json` |
| `internal/scrub` | PII redaction (MAC, e-mail, phone numbers) before anything leaves the car |
| `internal/limiter` | global uploads-per-hour cap |
| `internal/queue` | offline spool with size-capped eviction and ordered retry |
| `internal/uplink` | `http` (backend / API Gateway) and `iot` (AWS IoT Core HTTPS data plane with X.509 mTLS + IoT Jobs) |
| `internal/ota` | signed-update apply with path-traversal and link rejection, atomic swap and rollback |
| `internal/health` | per-boot metrics (underruns, A2DP reconnects, ambient temperature) |

The daemon uses the Go standard library only, with zero third-party dependencies (this keeps the supply-chain review for an in-vehicle binary small).

## Footprint (measured)
| | |
|---|---|
| Binary, linux/amd64 (static, stripped) | 6.2 MB |
| Binary, linux/arm64 (static, stripped) | 6.0 MB |
| RSS while tailing + after an OTA | ~9.7 MB |
| CPU | negligible; runs at nice 10, idle I/O class on AAOS |

## Build & test
Go is not required on the host:
```bash
docker run --rm --user $(id -u):$(id -g) -e GOCACHE=/tmp/gocache -e HOME=/tmp -v "$PWD":/src -w /src/hu-sentinel \
  golang:1.23-alpine sh -c 'go test ./... && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/hu-sentinel ./cmd/hu-sentinel \
  && CGO_ENABLED=0 GOARCH=arm64 go build -ldflags="-s -w" -o bin/hu-sentinel-arm64 ./cmd/hu-sentinel'
```

## Run the local demo (from the repo root)
```bash
scripts/run-headunit.sh          # virtual head unit (cold boots at -8 °C) + hu-sentinel against the backend on :8000
```
Or run the two parts separately:
```bash
cp hu-sentinel/config.example.json hu-sentinel.json
hu-sentinel/bin/hu-sentinel --config hu-sentinel.json
.venv/bin/python sim/headunit.py --service-path .hu/system/media-service --temp -8 --out .hu/logcat.log
```

## Rules
Rules live in `rules.json` (hot-swappable through the IoT device shadow in the AWS deployment). Example:
```json
{ "id": "BT_AUDIO_UNDERRUN", "match": "AudioFlinger: .*underrun", "count": 20, "window_s": 10,
  "all_of": [{ "id": "A2DP_STALL", "match": "BluetoothA2dp: A2DP sink stalled", "count": 1, "window_s": 10 }],
  "severity": "high", "capture": ["logs_60s", "proc", "audio_15s", "screen_15s"], "cooldown_s": 60,
  "summary": "{count} AudioFlinger underruns in {window_s}s + A2DP stall" }
```

## Shipping on AAOS
- Built into `system_ext` as a prebuilt, started by init via [`hu-sentinel.rc`](hu-sentinel.rc) after `sys.boot_completed`, in the background cpuset at low priority.
- It runs as its own `hu_sentinel` user in a dedicated SELinux domain (`hu_sentinel.te`). That domain is allowed to read `logd` (`read_logd`), `/proc` stats and its `/data/vendor/hu-sentinel` dir, and to make outbound network connections. It has no access to app data.
- `dumpsys`, audio (`tinycap`) and screen (`screenrecord`) captures are requested through a small privileged helper (or the existing BugReport/`dumpstate` HAL), so the daemon itself stays unprivileged.
- Device identity: a per-vehicle X.509 certificate provisioned at end-of-line (AWS IoT fleet provisioning). The OTA signing public key is baked into the image.

# Design: Field-to-Fix

## Components
| Component | Path | AWS mapping |
|---|---|---|
| Signal crawlers | `backend/app/signals/sources.py` | Lambda + EventBridge Scheduler; AgentCore Browser for JS forums |
| Triage + clustering | `signals/triage.py`, `signals/cluster.py` | Bedrock (Claude, Titan embeddings) |
| hu-sentinel | `hu-sentinel/` (Go) | IoT Core (mTLS) + IoT Jobs |
| Device ingest | `main.py /api/device/*`, `aws_lambda.device_ingest` | IoT topic rule → Lambda → EventBridge |
| Pipeline | `pipeline/runner.py`, `agents/stages.py` | Step Functions (stage groups as Lambda tasks, waitForTaskToken approval) |
| State | `store.py` | DynamoDB single table + S3 (bundles, artifacts) |
| Fleet analytics | `fleetdata.py` | Athena over S3 telemetry (FleetWise campaigns for extra signals) |
| Release | `signing.py`, `connectors/ota.py` | AWS Signer + IoT Jobs (canary → exponential rollout, abort on failure) |
| Console | `main.py` + `frontend/` | App Runner + Cognito |

## Data model
`Signal` → `cluster` → `Case` → 12 × `StageRun` (+ `Artifact`, `Link`, `LogLine`). See `backend/app/models.py`.

## Sequence (hero flow)
1. hu-sentinel detects ≥20 AudioFlinger underruns / 10 s + A2DP stall → bundle → `/api/device/events`.
2. Cluster now has device + 5 public reports → `bug.detected` → pipeline.
3. Fleet: 197/500 vehicles, only HU-2.3.1, only ≤ 6.4 °C → regression window 2.2.9 → 2.3.1.
4. Reproduce: replay at −8 °C, HAL ready 850 ms vs stream at 200 ms → 33 underruns.
5. RCA: `git log -G` finds PERF-882 (1500 → 200 ms); origin = requirement (REQ-MEDIA-021 200 ms clause).
6. Requirement rev B + code fix + regression tests → PR.
7. Verify: tests fail on 2.3.1, pass on fix; replay clean −25…+20 °C.
8. Approve → sign → IoT job canary (real device + 4) → health clean → cohort → Jira resolved → forum reply.

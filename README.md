# Field-to-Fix

**Agentic V-cycle for automotive OEMs that starts at the field.** Owner complaints on forums, Reddit, X, the Google
Issue Tracker and partner trackers, plus rule-triggered bug reports from an on-vehicle daemon, become a root-caused,
tested, human-approved, signed OTA for exactly the affected vehicles.

```
 Field ──► Detect ─► Triage ─► Ticket                                   Monitor & Close ◄── Field
              (right side, going down)                                (right side, going up)
                 Fleet Impact ─► Reproduce                    Release (OTA) ◄─ Approve (human)
                            (left side)                    Verify
                 Root Cause ─► Requirement ─► Fix & PR ────┘
```

## What runs today (MVP: one bug, end to end)
**Hero case:** after HU-2.3.1, Bluetooth audio stutters and Android Auto drops for ~30 s after a cold start.

| Step | What happens | Real or simulated |
|---|---|---|
| Intake A | Crawler picks up an owners-forum post; 5 earlier public reports are already clustered | Forum: real (local mock site). Reddit: live with `F2F_REDDIT_LIVE=1`, else fixtures. X / Issue Tracker / partner Jira: fixtures |
| Intake B | `hu-sentinel` (Go) on the virtual head unit detects 25 underruns in 10 s plus an A2DP stall and uploads a PII-scrubbed bundle | **Real** daemon, real rule engine, real upload |
| Trigger | The cluster crosses the threshold (6 reporters, or a device report plus 2 public ones), so a case opens | Real |
| Fleet | 197 of 500 vehicles affected; only HU-2.3.1, only at ≤ 6.4 °C | Synthetic dataset (Athena query shown) |
| Reproduce | Replays −8 °C in the harness against the real 2.3.1 code: 33 underruns | **Real execution** |
| Root cause | `git log -G` finds commit PERF-882 (HAL wait 1500 → 200 ms); origin is the requirement | **Real git** |
| Requirement / Fix | REQ-MEDIA-021 rev B, code patch, 10 regression tests, PR | Real commits. PR goes to GitHub if configured, else to a local remote |
| Verify | New tests **fail on 2.3.1 and pass on the fix**; replay is clean from −25 to +20 °C | **Real pytest + replay** |
| Approve | Named approver in the console | Real gate |
| Release | Ed25519-signed tar.gz, IoT-Jobs-style job, canary of 5 | Signing is real. IoT Jobs is real in aws mode |
| Monitor | The daemon verifies the signature, installs atomically and reports a clean boot on 2.3.2. Then the cohort rollout, Jira resolve and forum reply | Demo device: **real**. The other 196 vehicles are simulated and labelled |

The agents call **Claude on Amazon Bedrock** (Converse API) when AWS credentials are present. Without them they use
deterministic analyzers, and the console shows `LLM: offline`. A model-generated patch is only accepted if it passes the
regression tests; otherwise the reviewed fix playbook is used, and the stage says so.

## Quick start (local, no AWS needed)
```bash
scripts/setup.sh                 # venv, frontend build, hu-sentinel build (uses Docker if Go is missing)
scripts/console.sh               # http://127.0.0.1:8000
# second terminal: virtual head unit (HU-2.3.1, −8 °C cold boots every 20 s) watched by hu-sentinel
RESET=1 scripts/run-headunit.sh
```
**Demo script (about 4 min):**
1. Overview → Signals: the cold-start cluster sits at 5 of 6 reporters.
2. Either start the head unit (Flow B) or post on the forum (`/forum` → "Fill example" → Post, Flow A). A case opens.
3. Case detail: watch the stages run live. Switch to the **V-model** view. Open a stage to see the reasoning, diffs, charts and links.
4. Approval banner → review the **evidence pack** → Approve.
5. The OTA lands on the head unit (the daemon log shows the signature verified and the install). The next cold boot reports 0 underruns, then the cohort rolls out and the ticket and forum reply close the loop.

`POST /api/demo/reset` restores the seeded state. `F2F_DEMO_PACE=0.3` speeds up agent steps.

## Integrations (`/integrations`)
Every stage uses a **capability** (`backend/app/connectors/base.py`), not a vendor. Configured connectors run for real;
unconfigured ones run in labelled *simulated* mode.

| Capability | Live in MVP | Extension slots |
|---|---|---|
| Issue tracker | Jira Cloud (`JIRA_*`) | ServiceNow, partner Jira |
| Source control | GitHub (`GITHUB_TOKEN`, `GITHUB_REPO`; run `scripts/publish-media-service.sh` once) | GitLab, Gerrit |
| CI / verification | Local test runner + replay | CodeBuild, Jenkins |
| Requirements ALM | Markdown in repo | Polarion, codebeamer, DOORS |
| OTA | AWS IoT Jobs (aws mode) or device plane | OEM OTA backends |
| LLM | Amazon Bedrock | — |

## AWS access and the EC2 console
See [docs/aws.md](docs/aws.md): credentials, region, and launching / redeploying / tearing down the console instance.

## AWS deployment (`infra/`, CDK Python)
DynamoDB (single table) · S3 (bundles, telemetry) · EventBridge bus (`bug.detected` → pipeline) · **Step Functions**
(stage groups as Lambda tasks, `waitForTaskToken` approval) · EventBridge Scheduler crawlers · IoT Core thing group,
device policy and topic rule → ingest Lambda · App Runner console · Cognito.
```bash
cd infra && python3 -m venv .venv && .venv/bin/pip install aws-cdk-lib==2.170.0 constructs
.venv/bin/python app.py                      # synth (verified: 41 resources)
npx cdk deploy --app ".venv/bin/python app.py"
```
> Status: the stack synthesizes, but it has **not been deployed** from this repo yet. The local orchestrator is the
> tested path (`pytest backend/tests`). The Lambda handlers, the DynamoDB store, the IoT HTTPS uplink in hu-sentinel and
> the Step Functions approval are implemented but untested against a live account.

## Repo map
| Path | |
|---|---|
| `backend/app` | FastAPI console: models, stages, pipeline runner, agents, connectors, signals, reports |
| `frontend/` | React + TypeScript console (React Flow pipeline and V-model, Recharts) |
| `hu-sentinel/` | Go on-vehicle daemon (stdlib only, ~6 MB static, ~10 MB RSS), see its README |
| `media-service/` | The head-unit component the agents fix (shipped defective at 2.3.1) |
| `sim/` | Thermal/timing model, replay harness, virtual head unit |
| `data/` | Fleet generator and social fixtures |
| `infra/` | CDK stack, Lambda image |
| `.kiro/` | Specs (requirements → design → tasks), steering, hooks |

## Tests
```bash
.venv/bin/python -m pytest -q backend/tests        # offline E2E: forum post → 12 stages → OTA → closed
(cd media-service && ../.venv/bin/python -m pytest -q)
(cd hu-sentinel && go test ./...)                  # or via the golang Docker image
```

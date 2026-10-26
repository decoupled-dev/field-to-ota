# Investigation Report: Field-to-Fix — AI Agents, MCP Servers & AWS Setup

## Summary

**Field-to-Fix** is a fully-implemented agentic V-cycle platform for automotive OEMs. It turns field complaints and in-vehicle bug reports into a verified, signed OTA update with a human release gate. The app is complete and working locally (offline), but **not yet deployed to AWS**. It already has code for every AWS service it needs, but none of them are active because credentials haven't been configured and the CDK stack hasn't been deployed (task item 14 in `.kiro/specs/field-to-fix/tasks.md`).

**What needs to be done:**
1. Configure AWS credentials + Bedrock model access
2. Deploy the CDK stack (41 resources)
3. Configure Jira, GitHub, and optionally Reddit/X credentials in `.env`
4. Create an MCP server config (`.kiro/settings/mcp.json`) for tools the agents can use — **none exists yet**
5. Potentially integrate Amazon Bedrock AgentCore Browser to crawl JS-heavy forums (task 15 is open)

---

## 1. What the Application Does

**Domain:** Automotive field quality and OTA release automation.

**Hero flow** (Bluetooth audio stutter on HU-2.3.1 after cold start):

```
Field (forum posts, Reddit, X, partner Jira, in-vehicle hu-sentinel daemon)
  → Signal intake & clustering → Case opened → 12-stage V-cycle pipeline:
     Detect → Triage → Ticket → Fleet Impact → Reproduce → Root Cause →
     Requirement → Fix & PR → Verify → Approve (human gate) →
     Release (signed OTA, canary + cohort) → Monitor & Close
```

Evidence: `README.md` lines 4–17; `backend/app/stages.py` STAGES list; `.kiro/specs/field-to-fix/design.md`.

---

## 2. All Components and Modules

| Directory / File | Role |
|---|---|
| `backend/app/main.py` | FastAPI console API (all endpoints) |
| `backend/app/models.py` | Core domain models: Signal, Case, StageRun, Artifact |
| `backend/app/stages.py` | Stage catalog (12 StageDef entries with agent names) |
| `backend/app/llm.py` | Amazon Bedrock Converse API wrapper; falls back to offline mode |
| `backend/app/config.py` | Runtime settings: AWS, Jira, GitHub, demo flags |
| `backend/app/agents/stages.py` | All 12 stage handlers (detect → monitor) |
| `backend/app/agents/playbook.py` | Reviewed fix playbook applied when LLM patch fails tests |
| `backend/app/pipeline/runner.py` | Local thread-based orchestrator; also the Step Functions entry point |
| `backend/app/signals/sources.py` | Forum + Reddit crawlers; fixture loader |
| `backend/app/signals/triage.py` | LLM-based (Bedrock) or deterministic signal triage |
| `backend/app/signals/cluster.py` | Cosine-similarity clustering (Titan embeddings or bag-of-words) |
| `backend/app/signals/ingest.py` | Signal normalization, cluster assignment, trigger policy |
| `backend/app/connectors/base.py` | Connector protocol definitions |
| `backend/app/connectors/registry.py` | Connector catalog (26 connectors across 10 capabilities) |
| `backend/app/connectors/trackers.py` | Jira Cloud REST + built-in simulated tracker |
| `backend/app/connectors/scm.py` | GitHub REST + local simulated SCM |
| `backend/app/connectors/ota.py` | AWS IoT Jobs + local device-plane simulator |
| `backend/app/reports/` | Evidence pack, RCA, fleet HTML reports |
| `backend/app/store.py` | SQLite-backed (local) or DynamoDB-backed (aws) state store |
| `backend/app/signing.py` | Ed25519 signing for OTA payloads |
| `backend/app/fleetdata.py` | Fleet telemetry query (Athena in aws mode, local dataset offline) |
| `backend/app/aws_lambda.py` | Lambda entry points for Step Functions, IoT ingest, crawlers |
| `backend/app/bus.py` | In-process SSE event bus (EventBridge in aws mode) |
| `backend/app/repo.py` | Git checkout helpers for the media-service working tree |
| `backend/app/seed.py` | Demo state seeder |
| `backend/tests/test_e2e.py` | Offline E2E test: forum post → 12 stages → OTA → closed |
| `frontend/` | React + TypeScript + Vite + Tailwind console (V-model, pipeline, fleet, reports) |
| `hu-sentinel/` | Go on-vehicle daemon: log tail, rule engine, bundle capture, PII scrub, OTA apply |
| `media-service/` | Head-unit media component (defective at 2.3.1, fixed at 2.3.2 by agents) |
| `sim/` | Thermal/timing model and replay harness |
| `data/` | Fleet generator (500 vehicles) + social signal fixtures |
| `infra/app.py` | CDK v2 stack (41 resources across DynamoDB, S3, EventBridge, Step Functions, Lambda, Scheduler, IoT Core, App Runner, Cognito) |

---

## 3. AI Agents Currently Defined

The app uses **stage-based agents**, not Amazon Bedrock named Agents. All agent logic is hand-written Python in `backend/app/agents/stages.py`; each function is one stage handler. Claude is called via the Bedrock Converse API for intelligence, but the orchestration is the app's own pipeline runner / Step Functions.

| Stage | Agent name (in stages.py) | LLM usage |
|---|---|---|
| detect | Signal Crawlers / Bundle Analyzer | None — reads stored signals |
| triage | Triage Agent | `llm.complete_json(TRIAGE_SYS, ...)` — extracts component, version, conditions, severity |
| ticket | Triage Agent | None — writes to issue tracker |
| fleet | Fleet Correlator | None — runs Athena / local dataset |
| reproduce | Repro Agent | None — runs `replay.boot()` |
| rca | RCA Agent | `llm.complete_json(RCA_SYS, ...)` — root cause from diffs + logs + design doc |
| requirement | Fix Agent | None — applies playbook |
| fix | Fix Agent | `llm.complete_json(FIX_SYS, ...)` — generates code patch; falls back to playbook if tests fail |
| verify | Verification Agent | None — runs pytest + replay matrix |
| approve | Human reviewer | None — waits for API call or Step Functions task token |
| release | Release Agent | None — signs + creates IoT job |
| monitor | Release Agent | None — reads health, resolves ticket, replies to forum |

**Signal triage** also calls `llm.complete_json(SYSTEM, ...)` per inbound signal (not just at stage time).

**Cluster similarity** currently uses cosine similarity on a bag-of-words vector. The design doc (`design.md`) mentions "Bedrock Titan embeddings when available" but the code in `signals/cluster.py` does not yet call Bedrock for embeddings — it uses the hashed bag-of-concepts path unconditionally.

---

## 4. MCP Servers Configured

**None.** Neither `~/.kiro/settings/mcp.json` nor `.kiro/settings/mcp.json` exists. There is no MCP server configuration anywhere in the workspace.

This is a gap: the agents currently call tools (Jira, GitHub, IoT Jobs, pytest, git) by calling Python connector code directly, not through MCP. The design doc references "AgentCore Browser" for JS-heavy forum crawling (task 15 is open) but that integration hasn't been wired to MCP yet.

---

## 5. Amazon / AWS Services Referenced

### Active in local mode (simulated)
| Service | Where | Purpose |
|---|---|---|
| Amazon Bedrock (Converse API) | `backend/app/llm.py` | Claude for triage, RCA, code fix |
| Amazon Bedrock (Titan embeddings) | `signals/cluster.py` comment / design doc | Signal clustering (not yet implemented) |
| AWS IoT Jobs | `connectors/ota.py` AwsIotJobs | Signed OTA rollout |
| AWS Athena | `fleetdata.py`, `agents/stages.py` fleet handler | Fleet telemetry SQL |

### Active in aws mode (CDK stack, not yet deployed)
| Service | CDK construct | Purpose |
|---|---|---|
| Amazon DynamoDB | `ddb.Table` (single table) | All state (signals, cases, stages, artifacts) |
| Amazon S3 | `Bundles`, `Telemetry` buckets | Artifact bundles, device telemetry |
| Amazon EventBridge | `events.EventBus` `field-to-fix` | `bug.detected` → Step Functions, crawl events |
| AWS Step Functions | `sfn.StateMachine` | Pipeline orchestration, `waitForTaskToken` approval |
| AWS Lambda | `stage_group`, `device_ingest`, `crawl` | Stage execution, IoT ingest, scheduled crawlers |
| EventBridge Scheduler | forum every 2 min, Reddit every 15 min | Crawler scheduling |
| AWS IoT Core | `CfnThingGroup`, `CfnThing`, `CfnTopicRule` | Device events and OTA jobs |
| AWS App Runner | `apprunner.CfnService` | Console hosting |
| Amazon Cognito | `cognito.UserPool` | Console authentication |
| AWS Signer | IAM policy `signer:StartSigningJob` | OTA payload code signing |
| AWS IoT FleetWise | Connector registry (status: `available`) | Targeted signal campaigns (not wired yet) |
| AWS CodeBuild | Connector registry (status: `available` in local mode) | CI verification matrix |

Source: `infra/app.py`, `connectors/registry.py`, `config.py`.

---

## 6. External APIs and Integrations

| Integration | Status | Configured via |
|---|---|---|
| Jira Cloud (issue tracker) | Simulated (no creds) | `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT` |
| GitHub (SCM, PR) | Simulated (no creds) | `GITHUB_TOKEN`, `GITHUB_REPO` |
| Reddit (public JSON API) | Disabled (`F2F_REDDIT_LIVE=0`) | `F2F_REDDIT_LIVE=1` to enable |
| X / Twitter | Simulated (fixture only) | `X_BEARER_TOKEN` (not yet implemented) |
| Google Issue Tracker | Simulated (fixture only) | Not implemented |
| Partner Jira | Simulated (fixture only) | `PARTNER_JIRA_URL`, `PARTNER_JIRA_TOKEN` |
| ServiceNow | Available (not wired) | `SN_INSTANCE`, `SN_TOKEN` |
| GitLab | Available (not wired) | `GITLAB_URL`, `GITLAB_TOKEN` |
| Gerrit | Available (not wired) | `GERRIT_URL` |
| Jenkins | Available (not wired) | `JENKINS_URL` |
| Polarion ALM | Available (not wired) | `POLARION_URL`, `POLARION_TOKEN` |
| Slack | Available (not wired) | `SLACK_WEBHOOK_URL` |
| Microsoft Teams | Available (not wired) | — |
| dSPACE / Vector HIL | Available (not wired) | — |
| AgentCore Browser | Referenced in tasks (task 15 open) | Not implemented |

Source: `connectors/registry.py`.

---

## 7. Build System, Test Runner, Dependencies

### Python backend
- **Runtime:** Python 3.12, venv at `.venv/`
- **Dependencies:** `backend/requirements.txt` — FastAPI 0.115.6, uvicorn, Pydantic 2, boto3 1.35.90, httpx, Jinja2, cryptography, pytest 8.3.4
- **Build:** `python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt` (via `scripts/setup.sh`)
- **Test command:** `.venv/bin/python -m pytest -q backend/tests`
- **Test runner:** pytest, one test file `backend/tests/test_e2e.py`

### media-service
- **pyproject.toml:** version 2.3.1, pytest, testpaths = tests
- **Test command:** `(cd media-service && ../.venv/bin/python -m pytest -q)`

### Frontend
- **Runtime:** Node, npm
- **Framework:** React 18 + TypeScript 5.6 + Vite 5.4 + Tailwind 3 + React Flow + Recharts
- **Build:** `(cd frontend && npm ci && npm run build)`
- **No frontend tests configured.**

### hu-sentinel (Go daemon)
- **Go 1.23, stdlib only, zero third-party deps**
- **Build:** `(cd hu-sentinel && CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/hu-sentinel ./cmd/hu-sentinel)` or via Docker
- **Test command:** `(cd hu-sentinel && go test ./...)`

### CDK infra
- **aws-cdk-lib 2.170.0, constructs**
- **Synth:** `cd infra && .venv/bin/python app.py` (verified: 41 resources)
- **Deploy:** `npx cdk deploy --app ".venv/bin/python app.py"`

---

## 8. Kiro Hooks

Two hooks exist in `.kiro/hooks/`:

| Hook file | When triggers | What it does |
|---|---|---|
| `run-tests.kiro.hook` | `backend/app/**/*.py` edited | Runs `.venv/bin/python -m pytest -q backend/tests` and fixes failures |
| `ui-rules.kiro.hook` | `frontend/src/**/*.tsx` edited | Reviews component against `.kiro/steering/ui.md` design rules |

Both hooks are `enabled: true` and use `askAgent`.

---

## 9. Steering Files

| File | Content |
|---|---|
| `.kiro/steering/product.md` | Product definition: agentic V-cycle, target users (OEM engineers), ASPICE/R156 audit evidence requirement, "never fake" |
| `.kiro/steering/tech.md` | Tech stack conventions: FastAPI, Pydantic v2, Bedrock Converse API, stage handler patterns, React+Vite |
| `.kiro/steering/ui.md` | UI design rules: Linear/Datadog density, Inter font, slate palette, no gradients/emoji, simulated connectors always labelled |

---

## 10. Data Flow: Field to OTA

```
FIELD INTAKE
  Forum/Reddit/X/partner post  ──► signals/sources.py (poll_forum, poll_reddit)
  hu-sentinel on vehicle        ──► /api/device/events (multipart: JSON meta + tar.gz bundle)
                                       ↓
                              signals/ingest.py → signals/triage.py (Bedrock or offline)
                                       ↓
                              signals/cluster.py (cosine similarity clustering)
                                       ↓ (when threshold crossed)
PIPELINE (pipeline/runner.py or Step Functions)
  detect     → reads stored signals, parses bundle
  triage     → Bedrock Claude: extracts problem statement, conditions, severity
  ticket     → Jira REST: creates defect ticket
  fleet      → Athena SQL (or local dataset): 197/500 vehicles, only 2.3.1, ≤6.4°C
  reproduce  → sim/replay.py: replays -8°C → 33 underruns confirmed
  rca        → git log -G + Bedrock Claude: finds PERF-882 commit, traces to REQ-MEDIA-021
  requirement→ amends REQ-MEDIA-021 rev B in repo, commits
  fix        → Bedrock Claude (or playbook): patches config.py + a2dp_manager.py + tests, PR
  verify     → pytest: tests FAIL on 2.3.1, PASS on fix; replay matrix −25…+20°C clean
  approve    → waits for human API call (or Step Functions waitForTaskToken)
  release    → Ed25519 sign → tar.gz OTA payload → AWS IoT Jobs canary (1 real + 4 sim)
  monitor    → reads device health reports → marks fixed → resolves Jira → replies to forum
```

---

## 11. What's Missing / Open Tasks

From `.kiro/specs/field-to-fix/tasks.md`:

- **Task 14 (open):** Deploy to AWS account; enable Bedrock model access; configure Jira + GitHub secrets
- **Task 15 (open):** AgentCore Browser crawler for JS-heavy forums; X API source

Additional gaps identified during investigation:

1. **No MCP server config** — `.kiro/settings/mcp.json` does not exist. Agents call connectors directly as Python code.
2. **Titan embeddings not implemented** — `signals/cluster.py` says "Bedrock Titan embeddings when available" in its docstring but the code always uses the offline bag-of-words path regardless of Bedrock availability.
3. **No Kiro CLI integration** — No `kiro.config.*`, no CLI invocations, no `@kiro` references anywhere.
4. **CDK stack synthesizes but is not deployed** — the `infra/cdk.out/` directory has a synthesized template, but the stack has never been applied to a live AWS account (README confirms this).
5. **hu-sentinel IoT uplink not activated** — `config.example.json` has placeholder IoT endpoint; the daemon is running in HTTP mode against `http://127.0.0.1:8000`.

---

## 12. Recommendations

### A. Amazon Bedrock Agents Needed

The app uses Bedrock today as a raw LLM (Converse API calls in `llm.py`). These are the integrations to activate:

| Integration | Priority | What to do |
|---|---|---|
| **Bedrock Converse API (Claude)** | Critical | Set `BEDROCK_MODEL_ID=us.anthropic.claude-sonnet-4-5-20250929-v1:0` and configure AWS credentials. Already coded in `llm.py`, just needs creds. |
| **Bedrock Titan Text Embeddings** | High | Implement in `signals/cluster.py` — the `_vector()` function should call `bedrock-runtime.invoke_model("amazon.titan-embed-text-v1")` when `llm.available()`. This upgrades clustering from bag-of-words to semantic. |
| **Amazon Bedrock AgentCore Browser** | Medium | For task 15: add a new signal source in `signals/sources.py` that uses AgentCore Browser to crawl JS-rendered owner forums (e.g., OEM-hosted community sites). |

### B. MCP Servers to Create

Create `.kiro/settings/mcp.json`. These MCP servers map directly to the connector capabilities already in the codebase:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
    },
    "jira": {
      "command": "npx",
      "args": ["-y", "@sooperset/mcp-atlassian"],
      "env": {
        "JIRA_URL": "${JIRA_URL}",
        "JIRA_USERNAME": "${JIRA_EMAIL}",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
      }
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/dc/Abhinav/field-to-ota"]
    },
    "aws-kb-retrieval": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-aws-kb-retrieval-serverless"],
      "env": {
        "AWS_REGION": "${AWS_REGION}",
        "AWS_ACCESS_KEY_ID": "${AWS_ACCESS_KEY_ID}",
        "AWS_SECRET_ACCESS_KEY": "${AWS_SECRET_ACCESS_KEY}"
      }
    }
  }
}
```

Rationale for each:
- **github MCP:** The Fix agent calls GitHub REST directly in `connectors/scm.py`. With MCP, the agent can read PR state, check CI status, and explore the media-service repo through natural tool calls rather than raw HTTP.
- **jira MCP:** The Ticket and Monitor stages call Jira REST directly. MCP would let the triage/monitor agents query existing tickets for deduplication and comment through a standard interface.
- **filesystem MCP:** Gives agents (running in the Kiro context) direct read access to the repo — useful for RCA and Fix agents to explore code without going through the subprocess `git show` path.
- **aws-kb-retrieval MCP:** The RCA agent already has a `knowledge_base.retrieve(...)` tool call stubbed in `agents/stages.py` (line: `ctx.tool("knowledge_base.retrieve('audio HAL readiness low temperature') → docs/design/audio-startup.md, HW-NOTE-117")`). This is currently just a label; wiring a Bedrock Knowledge Base MCP server would make it real.

### C. Kiro CLI Integration

There are no `kiro.config` files or CLI hooks. The two existing `.kiro/hooks/` files cover backend test runs and UI design checks. Additions that would help:

1. **AWS deploy hook** — a `post-merge` or manual hook that runs `npx cdk deploy` after the CDK stack is changed.
2. **Bedrock model access check hook** — a hook on `.env` changes that validates AWS credentials and Bedrock model access with a quick `aws bedrock list-foundation-models` call.

### D. AWS Deployment Steps (Task 14)

1. Create an AWS account / IAM role with Bedrock, DynamoDB, S3, Step Functions, Lambda, IoT, App Runner, Cognito access.
2. Request access to model `us.anthropic.claude-sonnet-4-5-20250929-v1:0` in Bedrock console (us-east-1).
3. Set environment variables (copy `.env.example` → `.env`, fill in `AWS_REGION`, `BEDROCK_MODEL_ID`, and credentials).
4. Run `cd infra && .venv/bin/python app.py` to confirm synth still passes.
5. Run `npx cdk deploy --app ".venv/bin/python app.py"`.
6. Run `scripts/publish-media-service.sh` to push media-service git history to the configured GitHub repo.
7. Set `F2F_MODE=aws` and the output URLs from CDK in the App Runner environment.

### E. Titan Embeddings — Concrete Code Change Needed

In `backend/app/signals/cluster.py`, replace `_vector()`:

```python
def _vector(sig: Signal) -> dict:
    # Try Bedrock Titan embeddings; fall back to bag-of-words
    if llm.available():
        try:
            import boto3, json
            client = boto3.client("bedrock-runtime", region_name=settings.aws_region)
            resp = client.invoke_model(
                modelId="amazon.titan-embed-text-v1",
                body=json.dumps({"inputText": f"{sig.title} {sig.body}"}),
                contentType="application/json", accept="application/json"
            )
            embedding = json.loads(resp["body"].read())["embedding"]
            # Use dimension index as key for cosine compatibility
            return {str(i): v for i, v in enumerate(embedding) if abs(v) > 1e-6}
        except Exception:
            pass  # fall through to offline
    # Offline bag-of-concepts
    base = _tokens(f"{sig.title} {sig.body} {sig.component or ''} {' '.join(sig.conditions)}")
    if sig.component:
        base[f"component:{sig.component}"] += 3
    return dict(base)
```

This mirrors the pattern in `llm.py` and degrades gracefully.

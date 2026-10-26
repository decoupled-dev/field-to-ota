# Tech stack and conventions

- Backend: Python 3.12, FastAPI, Pydantic v2 (`backend/app`). Models in `models.py`, stage catalog in `stages.py`.
- Stage handlers: `backend/app/agents/stages.py`. One function per stage, reporting only through `StageContext`.
- Connectors: capability protocols in `backend/app/connectors/base.py`; new vendors implement a protocol and register in `registry.py`.
- LLM: Amazon Bedrock Converse API (`llm.py`), Claude. Agents must degrade to deterministic analyzers when Bedrock is unavailable.
- Orchestration: local thread runner (`pipeline/runner.py`) == Step Functions in aws mode (`infra/app.py`, `aws_lambda.py`).
- Device daemon: Go 1.23, stdlib only (`hu-sentinel/`). Low footprint: no unbounded buffers, nice 10, rate-limited uplink.
- Frontend: React + TypeScript + Vite + Tailwind, shadcn-style primitives, React Flow, Recharts (`frontend/`).
- Tests: `pytest backend/tests` (offline E2E), `go test ./...` in hu-sentinel, `pytest` in media-service.

## MCP Servers (`.kiro/settings/mcp.json`)

Six MCP servers are configured for Kiro agents. All use `uvx` (installed at `~/.local/bin/uvx`):

| Server key | Package | Purpose in this app |
|---|---|---|
| `aws-core` | `awslabs.core-mcp-server` | IAM credential check, region/account introspection, general AWS SDK access (DynamoDB, S3, EventBridge, Step Functions) |
| `aws-docs` | `awslabs.aws-documentation-mcp-server` | Fetch live AWS service docs — CDK constructs, IoT Jobs API, Bedrock Converse API schema |
| `bedrock-kb` | `awslabs.bedrock-kb-retrieval-mcp-server` | Retrieve from a Bedrock Knowledge Base if one is created to index fleet/requirements docs |
| `aws-iot` | `awslabs.iot-twinmaker-mcp-server` | IoT Core thing group queries, job status, device shadow lookups |
| `aws-diagram` | `awslabs.aws-diagram-mcp-server` | Auto-generate architecture diagrams from CDK stack for audit/review evidence |
| `github` | `@modelcontextprotocol/server-github` (npx) | PR creation, branch listing, commit search — mirrors what `scm.py` connector does for the Fix agent |

Add `GITHUB_PERSONAL_ACCESS_TOKEN` to `.env` to activate the GitHub MCP server.

## Kiro Hooks (`.kiro/hooks/`)

| File | Trigger | What it does |
|---|---|---|
| `backend-tests.json` | PostFileSave (`backend/app/.*\.py$`) | Runs `pytest -q backend/tests`, auto-fixes failures |
| `frontend-ui-rules.json` | PostFileSave (`frontend/src/.*\.tsx$`) | Checks component against ui.md design rules |
| `infra-cdk-check.json` | PostFileSave (`infra/.*\.py$`) | Synths CDK stack, validates Bedrock/IoT IAM |
| `media-service-tests.json` | PostFileSave (`media-service/.*\.py$`) | Runs media-service regression tests |
| `session-context.json` | SessionStart | Loads full app context into every new Kiro session |

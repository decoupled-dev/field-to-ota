# Implementation Plan: Field Discovery Agent (Layer 1)

## Architecture Decisions

**Decision 1 — Connector protocol shape.**
`FieldDiscovery` is a new capability (`signal_source`) implemented as a class with `info: ConnectorInfo`
and `discover(oem, models, since_days) -> dict`. This matches the protocol-based pattern from `base.py`
(IssueTracker, OTAProvider, etc.). No formal `Protocol` class is added to `base.py` because the existing
protocols only define methods that cross connector boundaries; `discover` is field-discovery-specific and
its shape is enforced at the call site in the stage handler.

**Decision 2 — Three-tier fallback.**
`field_discovery_connector()` attempts: (1) Bedrock Agent via `bedrock-agent-runtime` `invoke_agent`
when `BEDROCK_AGENT_ID` is set in env/settings; (2) direct Lambda invocation when `FIELD_DISCOVERY_LAMBDA_ARN`
is set; (3) simulated mode reading from the seed JSON. This mirrors `ota_provider()` / `DevicePlaneJobs`.

**Decision 3 — Lambda bundling.**
Use `lambda_.Code.from_asset` with a dedicated asset directory
(`infra/lambda/field_discovery/`) rather than extending the Docker image. These Lambdas are
pure-Python stdlib + boto3 (already available in Lambda runtime) — no container needed.
The seed JSON is placed at `data/stellantis_seed_issues.json` in the repo root; the CDK asset
bundles the `infra/lambda/field_discovery/` directory and a `data/` subdirectory copy inside it,
so `SEED_DATA_PATH=/var/task/data/stellantis_seed_issues.json` resolves at runtime.

**Decision 4 — Stage position.**
`FIELD_DISCOVERY` is prepended as the new Stage 0 (before `detect`). It lives at
`v_side="field"`, `v_level="Field operation"` — same level as `detect`. The existing `detect` stage
remains unchanged; `field_discovery` feeds discovered issues into the signal store / shared context
for downstream stages to pick up.

**Decision 5 — `aws_bedrock` CDK import.**
CDK v2 >= 2.100 ships `aws_cdk.aws_bedrock`. Add `aws_cdk.aws_bedrock as bedrock` to the import
block in `infra/app.py`. The `CfnAgent` / `CfnAgentAlias` L1 constructs are used because the L2
constructs for Bedrock Agents are still unstable in CDK v2.

---

## Implementation Order

- [ ] 1. Create seed data file `data/stellantis_seed_issues.json`.
      15 realistic Stellantis/Uconnect issues covering: Bluetooth stutter after cold start (MVP hero bug),
      Android Auto disconnect on highway, Uconnect 8.4 freeze during nav, OTA stuck at 83%, CarPlay not
      recognized after iOS update, voice recognition misfire >40%, DAB radio drop on tunnel exit,
      backup camera latency >2 s, A/C unresponsive when radio active, map tile rendering blank after
      45 min, plus 5 additional realistic issues. Each entry:
      `{id, title, source, url, severity, frequency_score, affected_models, raw_count, summary,
        is_actionable_in_mvp, tags}`.
      Files: `data/stellantis_seed_issues.json`
      Verify: `python -c "import json; d=json.load(open('data/stellantis_seed_issues.json')); assert len(d)>=15"` — exits 0.

- [ ] 2. Create the search Lambda handler `infra/lambda/field_discovery/handler.py`.
      Must implement the Bedrock Agent action group protocol exactly:
      - Event in: `{messageVersion, actionGroup, function, parameters: [{name, type, value}, ...]}`
      - Response out: `{messageVersion, response: {actionGroup, function, functionResponse: {responseBody: {TEXT: {body: "<json_string>"}}}}}`
      Define `DISCOVERY_SOURCES: list[dict]` constant covering all 14 source categories (NHTSA API,
      NHTSA TSB, Transport Canada RVDB, JeepGarage.org, DodgeTalk.com, RamForumz.com, ChryslerForum.com,
      r/Jeep, r/Dodge, r/RAM, r/ChryslerPacifica, r/CarComplaints, Google Play/Apple App Store, 
      CarComplaints.com, CarProblemZoo.com, RepairPal.com, Twitter/X, TikTok, JIRA public board,
      CDK Global DMS). Each source: `{name, url_template, category, requires_auth, simulated_fallback}`.
      Functions dispatched by `event["function"]`:
        - `search_source(source_name, query, since_days)` — searches one source
        - `search_all_sources(oem, models, since_days)` — iterates all sources, returns results +
          per-source `live`/`simulated` status summary
      Uses `TAVILY_API_KEY` from env (SSM parameter fallback via boto3 if `TAVILY_SSM_PATH` set).
      If absent, returns results loaded from seed JSON at `SEED_DATA_PATH` env var, labelled
      `"simulated": true`.
      Files: `infra/lambda/field_discovery/handler.py`
      Verify: `python -c "from infra.lambda_.field_discovery.handler import DISCOVERY_SOURCES, lambda_handler; assert len(DISCOVERY_SOURCES)>=14"` — exits 0.
      (Import path will need `__init__.py`; create `infra/lambda/field_discovery/__init__.py` too.)

- [ ] 3. Create the ingest Lambda `infra/lambda/field_discovery/ingest.py`.
      Same Bedrock Agent action group protocol. Function dispatched: `ingest_issues(oem, issues_json)`.
      Steps:
        1. Parse `issues_json` (JSON string) into a list of issue dicts.
        2. Deduplicate using `difflib.SequenceMatcher` on `title` field; issues with ratio > 0.70
           are merged, keeping the entry with the highest `raw_count`.
        3. Write survivors to DynamoDB `FieldIssuesTable` (env: `FIELD_ISSUES_TABLE`).
           PK: `f"source#{item['source']}"`, SK: `f"oem#{oem}#id#{item['id']}"`.
        4. Return `{stored: N, deduplicated: M, clusters: [...titles of merged groups...]}`.
      Also expose `deduplicate_issues(issues: list[dict]) -> tuple[list[dict], list[dict]]` as a
      top-level function (not inside `lambda_handler`) so tests can import and unit-test it directly.
      Files: `infra/lambda/field_discovery/ingest.py`
      Verify: `python -c "from infra.lambda_.field_discovery.ingest import deduplicate_issues; r,m=deduplicate_issues([{'id':'1','title':'Bluetooth stutter cold start','raw_count':5},{'id':'2','title':'Bluetooth stutter after cold boot','raw_count':3}]); assert len(r)==1 and r[0]['raw_count']==5"` — exits 0.

- [ ] 4. Add CDK constructs to `infra/app.py`.
      Add `aws_cdk.aws_bedrock as bedrock` to the import block (after existing imports, alphabetically).
      Inside `FieldToFixStack.__init__`, after the existing DynamoDB table (`table`) definition, add:

      **a. FieldIssuesTable** — DynamoDB table:
        - `partition_key`: `{name: "pk", type: STRING}`, `sort_key`: `{name: "sk", type: STRING}`
        - `billing_mode: PAY_PER_REQUEST`, `removal_policy: DESTROY`
        - Name the CDK id `"FieldIssues"`

      **b. Two Lambda functions** using `lambda_.Function` (NOT `DockerImageFunction`):
        - Asset directory: `infra/lambda/field_discovery/` bundled using
          `lambda_.Code.from_asset(str(ROOT / "infra/lambda/field_discovery"))`
        - Runtime: `lambda_.Runtime.PYTHON_3_12`
        - `SearchFn` handler: `"handler.lambda_handler"`, timeout 5 min, memory 512 MB
        - `IngestFn` handler: `"ingest.lambda_handler"`, timeout 5 min, memory 512 MB
        - Environment for both: `FIELD_ISSUES_TABLE` = `field_issues_table.table_name`,
          `SEED_DATA_PATH` = `"/var/task/data/stellantis_seed_issues.json"`,
          `AWS_REGION_NAME` = `self.region`
        - The seed JSON must be present inside the Lambda asset. Achieve this by copying
          `data/stellantis_seed_issues.json` into `infra/lambda/field_discovery/data/`
          as part of the CDK bundling (use `lambda_.Code.from_asset` with a `BundlingOptions`
          that copies `../../data/stellantis_seed_issues.json` to `data/`, OR — simpler —
          add a pre-synth step that ensures the file exists at
          `infra/lambda/field_discovery/data/stellantis_seed_issues.json`).
          **Chosen approach:** At the top of `FieldToFixStack.__init__`, after ROOT is defined,
          add Python code that copies the seed file into the Lambda asset directory:
          ```python
          import shutil
          _seed_src = ROOT / "data/stellantis_seed_issues.json"
          _seed_dst = ROOT / "infra/lambda/field_discovery/data/stellantis_seed_issues.json"
          _seed_dst.parent.mkdir(parents=True, exist_ok=True)
          shutil.copy2(_seed_src, _seed_dst)
          ```
        - Grant each Lambda read/write on `field_issues_table`.
        - Add `bedrock` policy statement (same as existing `bedrock` IAM policy in the stack) to both.

      **c. Bedrock Agent execution role** — `iam.Role`:
        - Assumed by `iam.ServicePrincipal("bedrock.amazonaws.com")`
        - Policy: `bedrock:InvokeModel` on `*`, `lambda:InvokeFunction` on both Lambda ARNs.

      **d. Resource-based permissions** on each Lambda:
        - `search_fn.add_permission("BedrockInvokeSearch", principal=iam.ServicePrincipal("bedrock.amazonaws.com"), action="lambda:InvokeFunction")`
        - Same for ingest_fn.

      **e. `bedrock.CfnAgent`** named `"FieldDiscoveryAgent"`:
        - `foundation_model`: `"anthropic.claude-3-5-sonnet-20241022-v2:0"`
        - `instruction`: Detailed prompt: "You are a field intelligence analyst for automotive OEMs.
          Given an OEM name and vehicle model list, systematically search all configured complaint and
          feedback sources for software-related issues. Use search_all_sources to crawl all sources,
          then ingest_issues to store and deduplicate the results. Return a structured JSON report with:
          total_issues, deduplicated_count, actionable_issues (list), source_coverage (per-source
          live/simulated status), top_priority_issues (top 5 by frequency_score)."
        - Two action groups:
          - `web-search-action`: `action_group_executor` with Lambda ARN of `search_fn`,
            `action_group_state: "ENABLED"`,
            `function_schema` covering `search_source` and `search_all_sources` with their parameters.
          - `issue-ingest-action`: `action_group_executor` with Lambda ARN of `ingest_fn`,
            `action_group_state: "ENABLED"`,
            `function_schema` covering `ingest_issues`.
        - `agent_resource_role_arn`: the execution role ARN from step c.

      **f. `bedrock.CfnAgentAlias`** named `"FieldDiscoveryLive"`:
        - `agent_id`: `field_discovery_agent.ref`
        - `agent_alias_name`: `"live"`

      **g. CfnOutputs**: `FieldDiscoveryAgentId` and `FieldDiscoveryAliasArn`.

      Files: `infra/app.py`
      Verify: `cd infra && .venv/bin/python app.py 2>&1 | tail -5` — synthesises without error (cdk.out updated).

- [ ] 5. Create `backend/app/connectors/field_discovery.py`.
      Follow the exact pattern of `ota.py`: two classes + a factory function.

      **`BedrockAgentFieldDiscovery`** (used when `BEDROCK_AGENT_ID` in env):
        - `info = ConnectorInfo("field_discovery", "Field Discovery Agent", "AWS Bedrock", "signal_source",
            "Crawls NHTSA, forums, Reddit, app stores and social media for Stellantis/Uconnect issues.",
            "connected", ["BEDROCK_AGENT_ID", "BEDROCK_AGENT_ALIAS_ID"])`
        - `self.simulated = False`
        - `discover(oem, models, since_days) -> dict`:
          Invokes Bedrock Agent via `boto3.client("bedrock-agent-runtime").invoke_agent(
            agentId=..., agentAliasId=..., sessionId=f"f2f-{oem}-{int(time.time())}",
            inputText=json.dumps({"oem": oem, "models": models, "since_days": since_days}))`.
          Accumulates streaming `completion` event chunks, parses JSON from the final response.

      **`LambdaFieldDiscovery`** (used when `FIELD_DISCOVERY_LAMBDA_ARN` in env, no Agent deployed):
        - `info.status = "connected"`, `self.simulated = False`
        - `discover`: invokes the search Lambda directly via `boto3.client("lambda").invoke(...)`.

      **`SimulatedFieldDiscovery`** (fallback):
        - `info.status = "simulated"`, `self.simulated = True`
        - `discover`: reads seed JSON from `data/stellantis_seed_issues.json` (relative to `ROOT`),
          filters by `is_actionable_in_mvp`, returns `{issues: [...], simulated: True, sources: [...]}`.

      **`field_discovery_connector()`** factory:
        ```python
        def field_discovery_connector():
            if settings.mode == "aws" and os.environ.get("BEDROCK_AGENT_ID"):
                return BedrockAgentFieldDiscovery()
            if os.environ.get("FIELD_DISCOVERY_LAMBDA_ARN"):
                return LambdaFieldDiscovery()
            return SimulatedFieldDiscovery()
        ```

      Files: `backend/app/connectors/field_discovery.py`
      Verify: `F2F_LLM=offline python -c "from backend.app.connectors.field_discovery import field_discovery_connector; c=field_discovery_connector(); print(c.info.status)"` — prints `simulated`.

- [ ] 6. Register `field_discovery_connector` in `backend/app/connectors/registry.py`.
      Add import: `from .field_discovery import field_discovery_connector`
      Add a new tuple at the top of the `entries` list (before the reddit entry):
      ```python
      (field_discovery_connector().info, ["field_discovery"]),
      ```
      This wires the connector into the Integrations page UI.
      Files: `backend/app/connectors/registry.py`
      Verify: `F2F_LLM=offline python -c "from backend.app.connectors.registry import catalog; keys=[e['key'] for e in catalog()]; assert 'field_discovery' in keys, keys"` — exits 0.

- [ ] 7. Prepend `FIELD_DISCOVERY` stage to `backend/app/stages.py`.
      Insert as the first element of `STAGES` (index 0):
      ```python
      StageDef(
          key="field_discovery",
          name="Field Discovery",
          v_level="Field operation",
          v_side="field",
          agent="Field Discovery Agent (Bedrock)",
          capability="signal_source",
          description="Crawls NHTSA, forums, Reddit, app stores and social to surface actionable Uconnect issues.",
      ),
      ```
      Files: `backend/app/stages.py`
      Verify: `python -c "from backend.app.stages import STAGES; assert STAGES[0].key=='field_discovery', STAGES[0].key"` — exits 0.

- [ ] 8. Add `field_discovery` stage handler in `backend/app/agents/stages.py`.
      Add at the top of the handler functions section (before `detect`). Import
      `field_discovery_connector` at the top of the file alongside the other connector imports.

      ```python
      from ..connectors.field_discovery import field_discovery_connector

      def field_discovery(ctx: StageContext) -> None:
          conn = field_discovery_connector()
          ctx.run.connector = conn.info.name
          ctx.run.simulated = conn.simulated
          oem = ctx.shared.get("oem", "Stellantis")
          models = ctx.shared.get("models", ["Dodge", "Jeep", "RAM", "Chrysler", "Uconnect"])
          since_days = ctx.shared.get("since_days", 90)
          ctx.thought(f"Searching {len(conn.info.config_keys or [])} source categories for {oem} issues over the last {since_days} days.")
          result = conn.discover(oem, models, since_days)
          issues = result.get("issues", [])
          source_log = result.get("sources", [])
          for src in source_log:
              status = "live" if not src.get("simulated") else "simulated"
              ctx.log(f"[{src.get('name', '?')}] {status}: {src.get('count', 0)} issues")
          actionable = [i for i in issues if i.get("is_actionable_in_mvp")]
          ctx.artifact("Discovered issues", "json", content=issues)
          ctx.artifact("Source coverage", "json", content=source_log)
          ctx.shared["discovered_issues"] = issues
          ctx.set(
              f"{len(issues)} issues discovered across {len(source_log)} sources, "
              f"{len(actionable)} actionable for MVP.",
              total_issues=len(issues),
              actionable=len(actionable),
              sources_live=sum(1 for s in source_log if not s.get("simulated")),
              sources_simulated=sum(1 for s in source_log if s.get("simulated")),
              engine="Bedrock Agent (FieldDiscovery)" if not conn.simulated else "simulated",
          )
      ```
      Files: `backend/app/agents/stages.py`
      Verify: `F2F_LLM=offline python -c "from backend.app.agents.stages import field_discovery; print('OK')"` — prints `OK`.

- [ ] 9. Create frontend component `frontend/src/components/stages/FieldDiscovery.tsx`.
      Renders the `field_discovery` stage run outputs following ui.md rules and the patterns in
      `StagePanel.tsx`, `domain.tsx`, and `badge.tsx`.

      Structure (dense, Linear/Datadog tone):
      - **Header row**: "Field Discovery" label, connector name, simulated badge if `run.simulated`.
      - **Metrics strip**: 3-cell grid (matching the `Stat` pattern from StagePanel):
        Total Issues (tabular-nums), Actionable (emerald chip count), Sources Covered.
      - **Source coverage table**: one row per source from `source_coverage` artifact JSON.
        Columns: Source name, Category, Status (amber badge "Simulated" / blue badge "Live"),
        Issue count (tnum). Border `border-border`, 1 px, 6 px radius, 13 px text.
      - **Top 5 issues table**: from `top_priority_issues` or top 5 of `discovered_issues` sorted by
        `frequency_score` desc. Columns: # (tnum), Title (truncate), Source (small text), Severity
        (SeverityBadge from domain.tsx), Raw Count (tnum), Actionable (emerald/slate chip).
      - Use `Badge` from `../ui/badge` with tones: `ok` for actionable, `neutral` for noise,
        `warn` for simulated sources, `run` for live.
      - No gradients, no emoji, no hero text. Inter 13–14 px. CSS vars for colours.

      The component receives `{ run: StageRun }` and reads `run.outputs` for the metrics
      and `run.artifacts` for the detailed tables (parse the `content` of the "Discovered issues"
      and "Source coverage" artifacts).

      Files: `frontend/src/components/stages/FieldDiscovery.tsx`
      Also create: `frontend/src/components/stages/` directory (implicit).
      Verify: `cd frontend && npx tsc --noEmit 2>&1 | grep -i "FieldDiscovery"` — no errors.

- [ ] 10. Create `backend/tests/test_field_discovery.py`.
       Follow `test_e2e.py` patterns: env vars set before any imports, offline mode.

       Tests to include:
       1. `test_simulated_connector_returns_issues` — asserts connector in simulated mode returns
          `dict` with `issues` key, `issues` is a non-empty list, each issue has `id`, `title`, `severity`.
       2. `test_simulated_flag_is_true` — asserts `connector.simulated is True` and
          `connector.info.status == "simulated"` for the simulated connector.
       3. `test_discover_response_shape` — asserts response has keys `issues`, `sources`, `simulated`.
       4. `test_deduplication_merges_similar_titles` — imports `deduplicate_issues` from
          `infra.lambda_.field_discovery.ingest` (note: Python module path uses underscores for
          the `lambda_` directory name — the implementer must ensure an `__init__.py` exists there),
          passes two issues with 80%+ similar titles, asserts only one survives, keeping higher
          `raw_count`.
       5. `test_deduplication_keeps_distinct_titles` — passes two clearly different titles, asserts
          both survive.
       6. `test_discovery_sources_cover_required_categories` — imports `DISCOVERY_SOURCES` from
          `infra.lambda_.field_discovery.handler`, asserts at least one source exists for each
          required category: `["nhtsa", "forum", "reddit", "app_store", "review_site", "social"]`.

       Files: `backend/tests/test_field_discovery.py`
       Verify: `.venv/bin/python -m pytest -q backend/tests/test_field_discovery.py` — all 6 tests pass.

---

## File creation / modification summary

| File | Action |
|------|--------|
| `data/stellantis_seed_issues.json` | CREATE — 15+ seed issues |
| `infra/lambda/field_discovery/__init__.py` | CREATE — empty, enables import |
| `infra/lambda/field_discovery/handler.py` | CREATE — search Lambda |
| `infra/lambda/field_discovery/ingest.py` | CREATE — ingest Lambda |
| `infra/lambda/field_discovery/data/stellantis_seed_issues.json` | CREATE — copy of seed (bundled into Lambda asset) |
| `infra/app.py` | MODIFY — add bedrock import, FieldIssuesTable, SearchFn, IngestFn, CfnAgent, CfnAgentAlias, outputs |
| `backend/app/connectors/field_discovery.py` | CREATE — 3 classes + factory |
| `backend/app/connectors/registry.py` | MODIFY — add field_discovery entry |
| `backend/app/stages.py` | MODIFY — prepend FIELD_DISCOVERY stage |
| `backend/app/agents/stages.py` | MODIFY — add import + field_discovery() handler |
| `frontend/src/components/stages/FieldDiscovery.tsx` | CREATE — stage component |
| `backend/tests/test_field_discovery.py` | CREATE — 6 offline tests |

## Dependency order

Items 1 → 2 → 3 (seed must exist before Lambda code references it; handler before ingest).
Item 4 (CDK) depends on 1–3 (seed copy, Lambda handlers exist).
Items 5–8 are independent of 4 and can proceed in parallel with CDK; 6 depends on 5, 7 is independent, 8 depends on 5 and 7.
Item 9 (frontend) is independent of all backend items.
Item 10 (tests) depends on 2, 3, and 5 being complete.

# Field Discovery Agent — Field-to-Fix integration

This change wires a new Field Discovery stage into the Field-to-Fix V-cycle pipeline. It adds a Bedrock Agent backed by two Lambda action-group handlers (search and ingest), a Simulated connector that falls back to a 15-issue Stellantis/Uconnect seed file, a registry entry and stage catalog prepend, a FastAPI stage handler, CDK constructs for the agent and its DynamoDB table, six backend tests, and a dense React frontend component. The hero scenario (Bluetooth stutter after cold start, `STL-001`) is present in the seed with `is_actionable_in_mvp=true`. The change is self-contained: it does not mutate existing stages or connector interfaces.

Watch for: (1) `BedrockAgentFieldDiscovery.discover()` accumulates streaming chunks without any size or timeout guard — a runaway agent response will buffer indefinitely in memory. (2) `LambdaFieldDiscovery.discover()` calls `Payload.read()` on the response object without checking the `FunctionError` key — a Lambda execution failure returns a 200 with `FunctionError` set and would be silently parsed as an empty or malformed dict. (3) The deduplication algorithm is greedy single-pass: early candidates absorb later ones even when the later candidates are more central to the cluster. For 15 seed items this is fine; at production volume with hundreds of semantically similar issues, survivor selection may be unstable across orderings.

**Verdict**: APPROVED

---

## High-level view

The connector follows the established `ota.py` factory pattern cleanly: three classes (BedrockAgent, Lambda, Simulated) behind a single `field_discovery_connector()` factory, with `simulated=True` and `info.status='simulated'` set correctly on `SimulatedFieldDiscovery`. The simulated path reads the seed file each call — fine for offline tests but worth noting for any high-frequency polling.

The stage handler integrates via `StageContext` exclusively (no direct DB/HTTP calls), stores `ctx.shared['discovered_issues']` for downstream stages, and emits properly shaped artifacts and outputs that the frontend reads by name. The field in `ctx.shared` is `'discovered_issues'` — downstream stages that expect a different key will not find it, but no existing downstream stage reads this key today so there is no immediate breakage.

The Lambda layer is structurally sound: `DISCOVERY_SOURCES` has 21 entries covering all required categories including NHTSA, Transport Canada, four OEM forums, five Reddit subs, both app stores, three review sites, two social platforms, a public JIRA board, and CDK Global DMS. The Bedrock Agent action-group protocol response shape is correctly implemented. The `deduplicate_issues` function is a true top-level export, importable without instantiating anything.

The CDK stack adds a `FieldIssues` DynamoDB table, two Lambda functions (search + ingest), an IAM role for the Bedrock Agent, `CfnAgent`, `CfnAgentAlias`, and CfnOutputs. The pre-existing local variable `bedrock` that would have shadowed the `aws_bedrock` module import was renamed to `bedrock_policy` — this is a correct fix for the name collision.

The frontend component follows the ui.md design rules: no gradients, no emoji, 13–14 px text, `tnum` tabular numerals on all counts, `border-border` everywhere, `rounded` (6 px), correct badge tones (`tone='run'` for live, `tone='warn'` for simulated, `tone='ok'` for actionable), and an inline `style` for the amber left border on the simulated callout (correct because Tailwind won't purge arbitrary `var()` border-color at build time).

---

<details>
<summary>Issues (3)</summary>

1. **Unbounded streaming buffer in BedrockAgentFieldDiscovery** — `discover()` appends all agent completion chunks into a single string with no size cap or timeout. A misbehaving agent response will grow the buffer until OOM or the process hangs. Add a max-bytes guard (e.g., 10 MB) and a per-chunk timeout, or use the `invoke_agent` `responseStreamingConfigurations` timeout parameter.

2. **Lambda FunctionError not checked in LambdaFieldDiscovery** — `response["Payload"].read()` returns the Lambda execution result body even when `response.get("FunctionError")` is set, silently passing a `{"errorMessage": ...}` dict to callers. Add `if response.get("FunctionError"): raise RuntimeError(...)` before parsing the payload.

3. **Greedy single-pass deduplication ordering sensitivity** — `deduplicate_issues` processes issues in list order; whichever issue appears first absorbs all similar ones regardless of whether it is the best representative. Two issues near the 0.70 threshold can be absorbed or not absorbed depending on which arrives first. This is acceptable for the 15-item seed file but will produce non-deterministic survivors in production. Sorting by `raw_count` descending before the greedy pass would make the output stable.

</details>

---

<details>
<summary>Details</summary>

### Streaming buffer gap in BedrockAgentFieldDiscovery

`discover()` iterates `response["completion"]` and appends every `chunk["bytes"]` decode to `accumulated` with no upper bound check. The Bedrock Converse streaming API can emit arbitrarily large payloads for a misbehaving or adversarially crafted agent instruction. In practice, Claude responses are bounded, but the caller has no recourse if an agent loops or the response is corrupted mid-stream — the method will block until the stream ends or the process is killed. Confirmed by reading `field_discovery.py` lines 27–37.

A `max_bytes` check after each append (e.g., raise if `len(accumulated) > 10 * 1024 * 1024`) and relying on `invoke_agent`'s `idleSessionTTLInSeconds` for timeout are the two lowest-friction mitigations without restructuring the call.

### Lambda execution failure is invisible

`LambdaFieldDiscovery.discover()` calls `self._client.invoke(...)` and immediately parses `response["Payload"].read()`. A Lambda execution error (unhandled exception in the function) is signalled by `response["FunctionError"] == "Unhandled"` alongside a 200 HTTP status; the `Payload` contains `{"errorMessage": "...", "errorType": "..."}` which `json.loads` parses successfully. The resulting dict will have no `issues` key, causing the stage handler to silently return zero issues with no error logged. Confirmed by reading `field_discovery.py` lines 51–60.

### Deduplication algorithm stability

The greedy single-pass loop in `deduplicate_issues` (confirmed at `ingest.py` lines 43–67) picks the first remaining issue as the candidate for each cluster, then absorbs any subsequent issue whose title similarity ratio exceeds 0.70. The `best = max(cluster, key=lambda i: i.get("raw_count", 0))` selection inside each cluster is correct for choosing the representative, but the cluster boundary itself is non-deterministic with respect to input order: issue A may absorb issue B (ratio = 0.71) on one run, while on a re-ordered list issue B might absorb a different issue C first, leaving A as a separate survivor. For the current 15-item seed this does not cause test failures. At production scale where issues arrive from multiple sources in arbitrary order, the same semantic cluster will produce different survivor sets across pipeline runs, making audit trails hard to reproduce. Sorting by `raw_count` descending before the greedy pass eliminates the instability without changing the algorithm's complexity.

### Source coverage completeness

`DISCOVERY_SOURCES` contains 21 entries with categories: `nhtsa`, `nhtsa_tsb`, `transport_canada`, `forum_jeep`, `forum_dodge`, `forum_ram`, `forum_chrysler`, `reddit_jeep`, `reddit_dodge`, `reddit_ram`, `reddit_pacifica`, `reddit_complaints`, `app_store_google`, `app_store_apple`, `review_carcomplaints`, `review_carproblemzoo`, `review_repairpal`, `social_twitter`, `social_tiktok`, `jira_public`, `cdkglobal_dms`. All six required categories from the acceptance test are present. The `social_twitter` and `social_tiktok` entries correctly set `requires_auth=True` so they always fall back to simulated results without an API key — this is the correct safe default.

### Seed data and MVP hero

The seed file has exactly 15 issues. STL-001 ("Bluetooth stutter after cold start") has `is_actionable_in_mvp=true`, `severity="high"`, `frequency_score=0.91`, and `raw_count=412` — correctly positioned as the hero bug. Five additional issues are also marked actionable (STL-002, STL-003, STL-005, STL-010, STL-012). STL-004 (OTA stuck at 83%) is deliberately `is_actionable_in_mvp=false`, which is consistent with the product decision to handle the OTA hang in a separate pipeline path.

### Not tested

- `BedrockAgentFieldDiscovery.discover()` and `LambdaFieldDiscovery.discover()` paths are not tested. These are live-only paths so skipping them in offline tests is reasonable, but a mock-boto3 test for the Lambda FunctionError scenario would catch the silent-failure gap described above.
- The `lambda_handler` dispatch in both `handler.py` and `ingest.py` is not exercised by any test. The action-group protocol response shape contract (`messageVersion`, `functionResponse.responseBody.TEXT.body`) is correct by inspection but untested.
- `SimulatedFieldDiscovery.discover()` filter branch where `filtered` is empty (unknown model names) falls back to returning all issues — not tested, but the behavior is intentional and readable.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `data/stellantis_seed_issues.json` | New — 15 Stellantis/Uconnect seed issues, MVP hero at STL-001 |
| `infra/lambda_/field_discovery/handler.py` | New — 21-source DISCOVERY_SOURCES catalog, Tavily/simulated search, Bedrock action-group protocol handler |
| `infra/lambda_/field_discovery/ingest.py` | New — `deduplicate_issues` (difflib ratio > 0.70), DynamoDB writer, ingest action-group handler |
| `infra/lambda_/field_discovery/data/stellantis_seed_issues.json` | New — copy of seed data bundled into Lambda asset |
| `infra/lambda_/field_discovery/__init__.py` | New — empty, enables `infra.lambda_.field_discovery.*` Python imports |
| `infra/lambda_/__init__.py` | New — empty, enables `infra.lambda_` as a package |
| `infra/__init__.py` | New — empty, enables `infra.*` as a package |
| `infra/app.py` | Modified — FieldIssues DynamoDB table, search/ingest Lambda functions, Bedrock Agent IAM role, CfnAgent, CfnAgentAlias, CfnOutputs; `bedrock` local var renamed to `bedrock_policy` |
| `backend/app/connectors/field_discovery.py` | New — BedrockAgentFieldDiscovery, LambdaFieldDiscovery, SimulatedFieldDiscovery classes and factory |
| `backend/app/connectors/registry.py` | Modified — `field_discovery_connector` import added; entry prepended at index 0 |
| `backend/app/stages.py` | Modified — `field_discovery` StageDef prepended at index 0 |
| `backend/app/agents/stages.py` | Modified — `field_discovery` handler added before `detect()`, import of `field_discovery_connector` |
| `backend/tests/test_field_discovery.py` | New — 6 offline tests covering connector, deduplication, and source coverage |
| `frontend/src/components/stages/FieldDiscovery.tsx` | New — MetricsStrip, SourceCoverageTable, TopIssuesTable, simulated callout, correct ui.md badge tones |
| `.agents/tasks/task-field-discovery/features/FEAT-{001,002,003}.json` | New — task-tracking files, not production code |

Full diff: `git diff master...feat/field-discovery`

</details>

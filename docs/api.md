# Field-to-Fix Console API (v1)

Base: `/api`. JSON unless noted. Models are in `backend/app/models.py`; the stage catalog is in `backend/app/stages.py`.

## System
| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{mode: "local"\|"aws", llm: "bedrock"\|"offline", version}` |
| GET | `/stages` | `StageDef[]` (12 stages, ordered) |
| GET | `/overview` | `{kpis: {open_cases, closed_cases, mttr_minutes, vehicles_affected, vehicles_fixed, signals_24h}, signals_by_source: [{source, count}], signals_timeline: [{t, reddit, forum, x, issuetracker, partner_jira, device}], cases: Case[]}` |
| GET | `/integrations` | `[{key, name, capability, status: "connected"\|"simulated"\|"available", description, stages: string[], vendor}]` |
| POST | `/demo/reset` | clears state and reseeds fixtures |

## Signals
| Method | Path | Returns |
|---|---|---|
| GET | `/signals?source=&case_id=` | `Signal[]` (newest first) |
| POST | `/signals` | ingest one raw signal → `Signal` (triaged + clustered) |
| GET | `/clusters` | `[{id, title, size, authors, sources: {source: count}, case_id, score, threshold, first_seen, last_seen, component, sw_version}]` |
| POST | `/clusters/{id}/promote` | `Case` (manually start the pipeline) |

## Cases
| Method | Path | Returns |
|---|---|---|
| GET | `/cases` | `Case[]` |
| GET | `/cases/{id}` | `{case: Case, stages: StageRun[], signals: Signal[]}` |
| POST | `/cases/{id}/approve` | body `{approver, comment}` → `Case` |
| POST | `/cases/{id}/reject` | body `{approver, comment}` → `Case` |
| GET | `/cases/{id}/fleet` | `{total_vins, affected_vins, cohort: [{vin, region, sw_version, min_temp_c, underruns, ota_status}], by_region: [{region, affected, total}], by_version: [{sw_version, affected, total}], by_temp: [{bucket, affected, total}], rollout: {wave, targeted, succeeded, failed, in_progress}, health: [{t, underruns}]}` |
| GET | `/cases/{id}/reports` | `[{type, title, description, url}]`, types are `evidence`, `rca`, `fleet` |
| GET | `/cases/{id}/reports/{type}` | `text/html` printable report (Ctrl+P → PDF) |

## Live events (SSE)
`GET /events` streams every event; `GET /cases/{id}/events` streams only that case's events.
Each SSE `data:` is an `Event` `{type, case_id, data, ts}`:
- `signal.created` `{signal}`
- `cluster.updated` `{cluster}`
- `case.created` / `case.updated` `{case}`
- `stage.updated` `{stage: StageRun}` (the full StageRun)
- `stage.log` `{stage, line: LogLine}`
- `ota.updated` `{rollout}`

## Artifacts
`GET /artifacts/{path}` serves files written by stages (logs, diffs, bundles).

## Device plane (hu-sentinel). In aws mode this is replaced by IoT Core HTTPS + IoT Jobs.
| Method | Path | Body / Returns |
|---|---|---|
| POST | `/device/events` | multipart: `meta` (JSON: `{thing, vin, rule_id, severity, sw_version, ts, metrics}`) + `bundle` (tar.gz) → `Signal` |
| GET | `/device/{thing}/jobs/next` | `{job_id, document: {version, artifact_url, sha256, signature}}` or 204 |
| POST | `/device/{thing}/jobs/{job_id}` | `{status: IN_PROGRESS\|SUCCEEDED\|FAILED, details}` |
| POST | `/device/{thing}/health` | `{vin, sw_version, metrics: {underruns, a2dp_reconnects, cpu, mem_mb}}` |

## Mock forum (live demo trigger)
- `GET /forum`: HTML forum UI ("DriveTalk" owners forum)
- `GET /api/forum/posts`: JSON for the crawler; `POST /api/forum/posts` `{author, title, body}`

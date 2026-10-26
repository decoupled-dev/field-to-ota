# Requirements: Field-to-Fix

## R1 Field signal intake
**User story:** As a field-quality engineer, I want complaints from public channels and vehicles collected automatically, so that defects are found before dealers escalate.
- WHEN a new post appears on a monitored source (owners forum, Reddit, X, Google Issue Tracker, partner Jira) THEN the system SHALL normalize it into a Signal within one crawl interval.
- WHEN hu-sentinel on a vehicle matches a rule THEN the system SHALL receive a bug bundle (log ring buffer, system state, optional audio/screen) with PII redacted on the device.
- The system SHALL classify each signal (is_bug, component, SW version, conditions, severity).

## R2 Clustering and trigger
- The system SHALL cluster signals describing the same defect by embedding similarity.
- WHEN a cluster reaches the reporter threshold (default 6 independent authors) OR has ≥1 device report and ≥2 public reports THEN the system SHALL open a case and start the pipeline.

## R3 Pipeline (V-cycle, right → left → right)
- The system SHALL execute: Detect, Triage, Ticket, Fleet Impact, Reproduce, Root Cause, Requirement, Fix & PR, Verify, Approve, Release, Monitor & Close.
- Each stage SHALL persist a StageRun with status, summary, reasoning, inputs/outputs, artifacts and external links.
- Root cause SHALL cite evidence (commit, logs, fleet statistics, replay result).
- Verification SHALL show the new regression tests fail on the defective build and pass on the fix.

## R4 Human release gate
- The system SHALL NOT start an OTA before a named approver approves the evidence pack.
- Rejection SHALL stop the pipeline and record the reason.

## R5 Targeted, signed OTA
- The payload SHALL be signed (Ed25519 / AWS Signer); the device SHALL verify sha256 and signature before installing atomically.
- Rollout SHALL target only the affected cohort, canary first; the cohort is released only after canary health is clean.

## R6 Close the loop
- Post-OTA device health SHALL confirm the fix; the ticket SHALL be resolved and public reporters answered.

## R7 Console
- Web console with Overview, Signals, Case detail (pipeline + V-model views, stage panel), Fleet & OTA, Reports, Integrations.
- Live updates (SSE). Reports printable to PDF.

## R8 Extensibility
- Integrations SHALL be pluggable per capability (issue tracker, SCM, CI, ALM, OTA, notifier, signal source).

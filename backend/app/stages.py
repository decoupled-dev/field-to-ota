"""Pipeline stage catalog. The UI renders stages generically from this list."""
from pydantic import BaseModel


class StageDef(BaseModel):
    key: str
    name: str
    v_level: str  # where it sits on the V-model
    v_side: str  # left | right | bottom | field | gate
    agent: str
    capability: str | None  # connector capability used by the stage
    description: str


STAGES: list[StageDef] = [
    StageDef(key="detect", name="Detect", v_level="Field operation", v_side="field", agent="Signal Crawlers / Bundle Analyzer",
             capability="signal_source", description="Field signals from social channels and in-vehicle hu-sentinel daemons."),
    StageDef(key="triage", name="Triage & Cluster", v_level="Field operation", v_side="field", agent="Triage Agent",
             capability=None, description="Classify, extract component / SW version / conditions, cluster duplicates."),
    StageDef(key="ticket", name="Ticket", v_level="Field operation", v_side="field", agent="Triage Agent",
             capability="issue_tracker", description="Open a defect in the OEM issue tracker with the evidence bundle."),
    StageDef(key="fleet", name="Fleet Impact", v_level="Vehicle validation", v_side="right", agent="Fleet Correlator",
             capability="fleet_analytics", description="Query fleet telemetry for the signature and compute the affected cohort."),
    StageDef(key="reproduce", name="Reproduce", v_level="System integration test", v_side="right", agent="Repro Agent",
             capability="sim", description="Replay field conditions in the simulation harness and confirm the defect."),
    StageDef(key="rca", name="Root Cause", v_level="Architecture & design", v_side="left", agent="RCA Agent",
             capability="source_control", description="Correlate logs, code and design docs into an evidenced root cause."),
    StageDef(key="requirement", name="Requirement", v_level="Requirements", v_side="left", agent="Fix Agent",
             capability="requirements_alm", description="Amend the violated requirement and keep traceability."),
    StageDef(key="fix", name="Fix & PR", v_level="Implementation", v_side="bottom", agent="Fix Agent",
             capability="source_control", description="Patch the code, add a regression test and open a pull request."),
    StageDef(key="verify", name="Verify", v_level="Unit & integration test", v_side="right", agent="Verification Agent",
             capability="ci", description="Run unit tests and the field-condition replay matrix against the fix."),
    StageDef(key="approve", name="Approve", v_level="Release gate", v_side="gate", agent="Human reviewer",
             capability=None, description="Safety / release owner reviews the evidence pack and approves the OTA."),
    StageDef(key="release", name="Release (OTA)", v_level="Vehicle release", v_side="right", agent="Release Agent",
             capability="ota", description="Sign the artifact and roll out over the air: canary, then cohort."),
    StageDef(key="monitor", name="Monitor & Close", v_level="Field operation", v_side="field", agent="Release Agent",
             capability="issue_tracker", description="Confirm post-OTA health from the fleet, resolve tickets, reply to the field."),
]

STAGE_KEYS = [s.key for s in STAGES]

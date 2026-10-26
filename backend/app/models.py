"""Core domain models shared by the API, the pipeline and the agents."""
from __future__ import annotations

import time
import uuid
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


def now() -> float:
    return time.time()


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


class SignalSource(str, Enum):
    reddit = "reddit"
    forum = "forum"
    x = "x"
    issuetracker = "issuetracker"
    partner_jira = "partner_jira"
    device = "device"


class Signal(BaseModel):
    """A normalized observation of a possible bug from any intake channel."""

    id: str = Field(default_factory=lambda: new_id("sig"))
    source: SignalSource
    external_id: str | None = None
    url: str | None = None
    author: str | None = None
    title: str
    body: str = ""
    created_at: float = Field(default_factory=now)
    # Enrichment from the triage agent
    component: str | None = None
    sw_version: str | None = None
    vehicle_model: str | None = None
    conditions: list[str] = []
    severity: str | None = None  # low | medium | high | critical
    is_bug: bool | None = None
    cluster_id: str | None = None
    case_id: str | None = None
    # Device signals carry a bundle
    vin: str | None = None
    rule_id: str | None = None
    bundle_key: str | None = None
    metrics: dict[str, Any] = {}


class Link(BaseModel):
    tool: str  # jira | github | gitlab | iot | athena | s3 | forum | ...
    label: str
    url: str


class Artifact(BaseModel):
    name: str
    kind: str  # log | diff | report | chart | bundle | text | json | test
    path: str | None = None  # relative to the artifacts dir; served from /api/artifacts/...
    content: Any = None  # small inline payloads (chart data, json, text)


class StageStatus(str, Enum):
    pending = "pending"
    running = "running"
    passed = "passed"
    failed = "failed"
    awaiting_approval = "awaiting_approval"
    skipped = "skipped"


class LogLine(BaseModel):
    ts: float = Field(default_factory=now)
    level: str = "info"  # info | tool | thought | warn | error
    msg: str


class StageRun(BaseModel):
    case_id: str
    stage: str
    status: StageStatus = StageStatus.pending
    agent: str = ""
    connector: str | None = None
    started_at: float | None = None
    ended_at: float | None = None
    summary: str = ""
    reasoning: str = ""
    inputs: dict[str, Any] = {}
    outputs: dict[str, Any] = {}
    artifacts: list[Artifact] = []
    links: list[Link] = []
    logs: list[LogLine] = []
    simulated: bool = False  # true when the connector ran in offline/simulated mode


class CaseStatus(str, Enum):
    open = "open"
    running = "running"
    awaiting_approval = "awaiting_approval"
    releasing = "releasing"
    closed = "closed"
    failed = "failed"


class Case(BaseModel):
    id: str = Field(default_factory=lambda: f"F2F-{uuid.uuid4().hex[:4].upper()}")
    title: str
    status: CaseStatus = CaseStatus.open
    severity: str = "high"
    component: str | None = None
    sw_version: str | None = None
    fixed_version: str | None = None
    vehicle_model: str | None = None
    created_at: float = Field(default_factory=now)
    updated_at: float = Field(default_factory=now)
    closed_at: float | None = None
    signal_ids: list[str] = []
    affected_vins: int = 0
    fixed_vins: int = 0
    current_stage: str | None = None
    links: list[Link] = []


class Event(BaseModel):
    """Pushed to the UI over SSE and (in aws mode) to EventBridge."""

    type: str  # signal.created | case.created | case.updated | stage.updated | stage.log | ota.updated
    case_id: str | None = None
    data: dict[str, Any] = {}
    ts: float = Field(default_factory=now)

"""Demo state: social fixtures below the trigger threshold, plus two historical closed cases for KPIs."""
from __future__ import annotations

import shutil

from .config import settings
from .models import Case, CaseStatus, Link, StageRun, StageStatus, now
from .pipeline import runner
from .repo import ensure_remote
from .signals import sources
from .signals.ingest import ingest
from .stages import STAGES
from .store import store

HISTORY = [
    {"title": "Rear-view camera feed appears 3 s late after shifting to R", "component": "camera", "sw": "HU-2.2.7", "fixed": "HU-2.2.8",
     "days_ago": 19, "mttr_min": 52, "vins": 61, "issue": "HU-87",
     "summaries": {"detect": "9 signals from 3 channels, including 2 in-vehicle bug reports", "fleet": "61 vehicles affected, all HU-2.2.7 with the 360° camera option",
                   "rca": "Camera HAL re-negotiates the stream format on every reverse engagement after a codec table change",
                   "release": "HU-2.2.8 released to canary 5 → cohort 61", "monitor": "Camera latency p95 0.4 s after OTA"}},
    {"title": "Voice assistant ignores wake word after Wi-Fi to LTE handover", "component": "voice", "sw": "HU-2.2.9", "fixed": "HU-2.2.10",
     "days_ago": 8, "mttr_min": 38, "vins": 24, "issue": "HU-94",
     "summaries": {"detect": "7 signals from 4 channels", "fleet": "24 vehicles affected, all with hotspot tethering enabled",
                   "rca": "Hotword engine keeps a stale network socket after handover; audio frames dropped",
                   "release": "HU-2.2.10 released to canary 5 → cohort 24", "monitor": "Wake-word success rate back to 98.7 %"}},
]


def _history() -> None:
    for i, h in enumerate(HISTORY):
        created = now() - h["days_ago"] * 86400
        case = Case(id=f"F2F-{0x0A1 + i * 0x13:04X}", title=h["title"], status=CaseStatus.closed, severity="high",
                    component=h["component"], sw_version=h["sw"], fixed_version=h["fixed"], created_at=created,
                    updated_at=created + h["mttr_min"] * 60, closed_at=created + h["mttr_min"] * 60,
                    affected_vins=h["vins"], fixed_vins=h["vins"],
                    links=[Link(tool="jira", label=h["issue"], url=f"{settings.public_url}/tools/issues/{h['issue']}")])
        store.put_case(case)
        step = h["mttr_min"] * 60 / len(STAGES)
        for n, sd in enumerate(STAGES):
            store.put_stage(StageRun(case_id=case.id, stage=sd.key, agent=sd.agent, status=StageStatus.passed,
                                     started_at=created + n * step, ended_at=created + (n + 1) * step,
                                     summary=h["summaries"].get(sd.key, f"{sd.name} completed")))


def reset() -> None:
    store.reset()
    for d in (settings.workspace_dir, settings.artifacts_dir):
        if d.exists() and d.resolve().is_relative_to(settings.state_dir.resolve()):
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)
    runner._approvals.clear()
    ensure_remote()
    _history()
    sources.seed_forum()
    for s in sources.fixture_signals():
        ingest(s, auto_trigger=False)


def ensure_seeded() -> None:
    if not store.list_cases() and not store.list_signals():
        reset()

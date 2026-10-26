"""Local pipeline orchestrator.

Runs the 12 stages of a case in order, persisting a StageRun per stage and streaming progress.
In aws mode the same stage handlers run as Lambda tasks inside the Step Functions state machine
(infra/), with the approval gate implemented as a waitForTaskToken state.
"""
from __future__ import annotations

import logging
import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable

from ..bus import bus
from ..config import settings
from ..models import Artifact, Case, CaseStatus, Link, LogLine, StageRun, StageStatus, now
from ..stages import STAGES
from ..store import store

log = logging.getLogger("f2f.pipeline")


class StageFailed(Exception):
    pass


class StageContext:
    """Handed to every stage handler: case state, shared scratch space and reporting helpers."""

    def __init__(self, case: Case, run: StageRun, shared: dict[str, Any]):
        self.case = case
        self.run = run
        self.shared = shared
        self.workdir = settings.workspace_dir / case.id
        self.workdir.mkdir(parents=True, exist_ok=True)

    def _save(self) -> None:
        store.put_stage(self.run)
        bus.publish("stage.updated", self.case.id, stage=self.run.model_dump(mode="json"))

    def log(self, msg: str, level: str = "info") -> None:
        line = LogLine(level=level, msg=msg)
        self.run.logs.append(line)
        store.put_stage(self.run)
        bus.publish("stage.log", self.case.id, stage=self.run.stage, line=line.model_dump(mode="json"))
        time.sleep(0.25 * settings.demo_pace)  # pacing so humans can follow the agent live

    def thought(self, msg: str) -> None:
        self.log(msg, "thought")

    def tool(self, msg: str) -> None:
        self.log(msg, "tool")

    def artifact(self, name: str, kind: str, content: Any = None, path: Path | None = None) -> None:
        rel = str(path.relative_to(settings.artifacts_dir)) if path else None
        self.run.artifacts.append(Artifact(name=name, kind=kind, content=content, path=rel))
        self._save()

    def write_artifact(self, name: str, kind: str, filename: str, text: str | bytes) -> Path:
        p = settings.artifacts_dir / self.case.id / filename
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(text if isinstance(text, bytes) else text.encode())
        self.artifact(name, kind, path=p)
        return p

    def link(self, tool: str, label: str, url: str, on_case: bool = True) -> None:
        lk = Link(tool=tool, label=label, url=url)
        self.run.links.append(lk)
        if on_case and all(l.url != url for l in self.case.links):
            self.case.links.append(lk)
            save_case(self.case)
        self._save()

    def set(self, summary: str | None = None, reasoning: str | None = None, **outputs) -> None:
        if summary is not None:
            self.run.summary = summary
        if reasoning is not None:
            self.run.reasoning = reasoning
        self.run.outputs.update(outputs)
        self._save()

    def update_case(self, **fields) -> None:
        for k, v in fields.items():
            setattr(self.case, k, v)
        save_case(self.case)


def save_case(case: Case) -> None:
    case.updated_at = now()
    store.put_case(case)
    bus.publish("case.updated", case.id, case=case.model_dump(mode="json"))


_approvals: dict[str, threading.Event] = {}
_decisions: dict[str, dict] = {}
_running: set[str] = set()


def wait_for_approval(ctx: StageContext) -> dict:
    ev = _approvals.setdefault(ctx.case.id, threading.Event())
    if settings.auto_approve:
        _decisions[ctx.case.id] = {"approved": True, "approver": "auto-approve (F2F_AUTO_APPROVE)", "comment": ""}
        ev.set()
    ev.wait()
    return _decisions.pop(ctx.case.id)


def decide(case_id: str, approved: bool, approver: str, comment: str) -> bool:
    if settings.mode == "aws":
        return _decide_sfn(case_id, approved, approver, comment)
    ev = _approvals.get(case_id)
    if ev is None or ev.is_set():
        return False
    _decisions[case_id] = {"approved": approved, "approver": approver, "comment": comment}
    ev.set()
    return True


def _decide_sfn(case_id: str, approved: bool, approver: str, comment: str) -> bool:
    import json

    import boto3
    doc = store.get_doc("kv", f"approval:{case_id}")
    if not doc or not doc.get("task_token"):
        return False
    sfn = boto3.client("stepfunctions", region_name=settings.aws_region)
    run = next(r for r in store.list_stages(case_id) if r.stage == "approve")
    run.status = StageStatus.passed if approved else StageStatus.failed
    run.ended_at = now()
    run.summary = f"{'Approved' if approved else 'Rejected'} by {approver}" + (f": “{comment}”" if comment else "")
    run.outputs.update(approver=approver, comment=comment, approved_at=now())
    store.put_stage(run)
    bus.publish("stage.updated", case_id, stage=run.model_dump(mode="json"))
    if approved:
        sfn.send_task_success(taskToken=doc["task_token"], output=json.dumps({"approver": approver}))
    else:
        sfn.send_task_failure(taskToken=doc["task_token"], error="Rejected", cause=comment or approver)
    store.put_doc("kv", f"approval:{case_id}", {})
    return True


def handlers() -> dict[str, Callable[[StageContext], None]]:
    from ..agents import stages as s
    return {"field_discovery": s.field_discovery, "detect": s.detect, "triage": s.triage, "ticket": s.ticket,
            "fleet": s.fleet, "reproduce": s.reproduce, "rca": s.rca, "requirement": s.requirement,
            "fix": s.fix, "verify": s.verify, "approve": s.approve, "release": s.release, "monitor": s.monitor}


def init_stages(case: Case) -> None:
    for sd in STAGES:
        store.put_stage(StageRun(case_id=case.id, stage=sd.key, agent=sd.agent))


def start(case: Case, from_stage: str | None = None) -> None:
    if case.id in _running:
        return
    _running.add(case.id)
    threading.Thread(target=_run, args=(case.id, from_stage), daemon=True, name=f"pipeline-{case.id}").start()


def _run_stage(case: Case, sd, shared: dict[str, Any]) -> StageStatus:
    run = StageRun(case_id=case.id, stage=sd.key, agent=sd.agent, status=StageStatus.running, started_at=now())
    ctx = StageContext(case, run, shared)
    ctx.update_case(current_stage=sd.key)
    ctx._save()
    try:
        handlers()[sd.key](ctx)
        if run.status == StageStatus.running:
            run.status = StageStatus.passed
    except StageFailed as e:
        run.status = StageStatus.failed
        ctx.log(str(e), "error")
    except Exception as e:  # unexpected: surface it on the stage instead of dying silently
        run.status = StageStatus.failed
        ctx.log(f"{type(e).__name__}: {e}", "error")
        log.error("stage %s failed:\n%s", sd.key, traceback.format_exc())
    if run.status != StageStatus.awaiting_approval:
        run.ended_at = now()
    ctx._save()
    if run.status == StageStatus.failed:
        ctx.update_case(status=CaseStatus.failed)
    return run.status


def _close(case: Case) -> None:
    case.status = CaseStatus.closed
    case.closed_at = now()
    case.current_stage = None
    save_case(case)


def _run(case_id: str, from_stage: str | None) -> None:
    try:
        case = store.get_case(case_id)
        shared: dict[str, Any] = {}
        started = from_stage is None
        case.status = CaseStatus.running
        save_case(case)
        for sd in STAGES:
            started = started or sd.key == from_stage
            if started and _run_stage(case, sd, shared) == StageStatus.failed:
                return
        _close(case)
    finally:
        _running.discard(case_id)


def run_group(case_id: str, stage_keys: list[str], task_token: str | None = None) -> dict:
    """Step Functions entry point (aws mode): run a group of stages in one Lambda invocation.

    `shared` is persisted between groups; the approval stage stores the task token and returns,
    and the console API completes it with SendTaskSuccess / SendTaskFailure.
    """
    case = store.get_case(case_id)
    shared = (store.get_doc("kv", f"shared:{case_id}") or {}) | ({"task_token": task_token} if task_token else {})
    by_key = {sd.key: sd for sd in STAGES}
    status = StageStatus.passed
    for key in stage_keys:
        status = _run_stage(case, by_key[key], shared)
        if status != StageStatus.passed:
            break
    store.put_doc("kv", f"shared:{case_id}", {k: v for k, v in shared.items() if k not in ("repo", "task_token")})
    if status == StageStatus.passed and stage_keys[-1] == STAGES[-1].key:
        _close(store.get_case(case_id))
    if status == StageStatus.failed:
        raise RuntimeError(f"stage {key} failed")
    return {"case_id": case_id, "status": status.value}

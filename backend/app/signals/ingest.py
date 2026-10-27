"""Single entry point for every intake channel: triage → cluster → maybe open a case."""
from __future__ import annotations

import logging

from ..bus import bus
from ..models import Case, Signal
from ..store import store
from . import cluster as clustering
from . import intake
from .triage import triage

log = logging.getLogger("f2f.ingest")


def ingest(sig: Signal, auto_trigger: bool = True) -> Signal:
    for existing in store.list_signals():
        if sig.external_id and existing.external_id == sig.external_id and existing.source == sig.source:
            return existing
    sig = triage(sig)
    src = sig.source.value
    if src == "device":
        intake.device_seen()
    if sig.is_bug:
        facts = " · ".join(x for x in [sig.severity, sig.component, sig.sw_version and f"SW {sig.sw_version}"] if x)
        intake.log(src, "triage", f"Triaged “{_short(sig.title)}” as a bug · {facts}", signal_id=sig.id)
    else:
        intake.log(src, "skip", f"“{_short(sig.title)}” doesn't describe a defect · kept, not clustered", signal_id=sig.id)
    c = clustering.assign(sig)
    if c:
        n, need = len(c["authors"]), c.get("threshold") or 0
        state = f"linked to case {c['case_id']}" if c.get("case_id") else f"{n} of {need} reporters needed to open a case"
        intake.log(src, "cluster", f"Grouped into “{_short(c['title'])}” · {state}", cluster_id=c["id"], case_id=c.get("case_id"))
    if c and c.get("case_id"):
        sig.case_id = c["case_id"]
        case = store.get_case(c["case_id"])
        if case and sig.id not in case.signal_ids:
            case.signal_ids.append(sig.id)
            store.put_case(case)
            bus.publish("case.updated", case.id, case=case.model_dump(mode="json"))
    store.put_signal(sig)
    bus.publish("signal.created", sig.case_id, signal=sig.model_dump(mode="json"))
    if c:
        bus.publish("cluster.updated", None, cluster=clustering.public(c))
        if auto_trigger:
            fire, reason = clustering.should_trigger(c)
            if fire:
                log.info("cluster %s triggered: %s", c["id"], reason)
                open_case(c, reason)
    return sig


def open_case(c: dict, reason: str) -> Case:
    from ..pipeline import runner
    case = Case(title=c["title"], component=c.get("component"), sw_version=c.get("sw_version"), signal_ids=list(c["signal_ids"]))
    c["case_id"] = case.id
    c["trigger_reason"] = reason
    store.put_doc("clusters", c["id"], c, c["first_seen"])
    for sid in c["signal_ids"]:
        s = store.get_signal(sid)
        if s:
            s.case_id = case.id
            store.put_signal(s)
    store.put_case(case)
    runner.init_stages(case)
    bus.publish("case.created", case.id, case=case.model_dump(mode="json"), reason=reason)
    intake.log(None, "case", f"Opened case {case.id} · {reason}", case_id=case.id)
    bus.publish("bug.detected", case.id, cluster=clustering.public(c), reason=reason)
    runner.start(case)
    return case


def _short(text: str, n: int = 64) -> str:
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"

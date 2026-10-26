"""Single entry point for every intake channel: triage → cluster → maybe open a case."""
from __future__ import annotations

import logging

from ..bus import bus
from ..models import Case, Signal
from ..store import store
from . import cluster as clustering
from .triage import triage

log = logging.getLogger("f2f.ingest")


def ingest(sig: Signal, auto_trigger: bool = True) -> Signal:
    for existing in store.list_signals():
        if sig.external_id and existing.external_id == sig.external_id and existing.source == sig.source:
            return existing
    sig = triage(sig)
    c = clustering.assign(sig)
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
    bus.publish("bug.detected", case.id, cluster=clustering.public(c), reason=reason)
    runner.start(case)
    return case

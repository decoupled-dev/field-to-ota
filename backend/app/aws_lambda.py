"""AWS Lambda entry points (aws mode). Packaged from the same code base as the console.

- stage_group:   Step Functions task, runs a group of pipeline stages for a case
- device_ingest: IoT topic rule f2f/devices/+/events → normalized device Signal → EventBridge
- crawl:         EventBridge Scheduler → one signal source poll
"""
from __future__ import annotations

import json

from .bus import bus
from .models import Signal, SignalSource
from .pipeline.runner import run_group
from .signals import sources
from .signals.ingest import ingest


def stage_group(event, _context):
    return run_group(event["case_id"], event["stages"], event.get("task_token"))


def device_ingest(event, _context):
    m = event if "rule_id" in event else json.loads(event.get("body", "{}"))
    sig = Signal(source=SignalSource.device, external_id=f"{m['thing']}:{m['rule_id']}:{int(m['ts'])}", author=m.get("vin"),
                 vin=m.get("vin"), rule_id=m["rule_id"], severity=m.get("severity"), bundle_key=m.get("bundle_key"),
                 sw_version=(m.get("sw_version") or "").removeprefix("HU-") or None, metrics=m.get("metrics") or {},
                 title=f"hu-sentinel · {m['rule_id']}", body=m.get("summary", ""), created_at=float(m["ts"]))
    s = ingest(sig)
    return {"signal_id": s.id, "case_id": s.case_id}


def crawl(event, _context):
    polls = {"forum": sources.poll_forum, "reddit": sources.poll_reddit}
    n = 0
    for s in polls[event.get("source", "forum")]():
        ingest(s)
        n += 1
    bus.publish("crawl.completed", None, source=event.get("source"), signals=n)
    return {"ingested": n}

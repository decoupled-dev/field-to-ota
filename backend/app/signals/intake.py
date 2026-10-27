"""Intake agent: what the crawlers are doing right now, for the Signals page.

Keeps per-source state (mode, last check, next check, last result) and a short ring buffer of agent
activity, and pushes both over the event bus as `intake.source` / `intake.activity`. Repeated empty
checks of one source update a single activity row instead of flooding the feed.
"""
from __future__ import annotations

import itertools
import threading
from collections import deque

from ..bus import bus
from ..config import settings
from ..models import Signal, now

_lock = threading.Lock()
_ids = itertools.count(1)
_activity: deque[dict] = deque(maxlen=80)
_idle_row: dict[str, dict] = {}  # source -> its latest "nothing new" activity row, while it is still the latest for that source

# kind: poll (agent checks on a cadence) or push (device uploads arrive on their own).
SOURCES: dict[str, dict] = {
    "forum": {"label": "Owners forum", "kind": "poll", "every": 5, "target": "DriveTalk owners forum"},
    "reddit": {"label": "Reddit", "kind": "poll", "every": 300 if settings.reddit_live else 30,
               "target": f"reddit search “{settings.reddit_query}”"},
    "x": {"label": "X", "kind": "poll", "every": 30, "target": "X recent search on product handles"},
    "issuetracker": {"label": "Issue Tracker", "kind": "poll", "every": 45, "target": "Google Issue Tracker · AAOS components"},
    "partner_jira": {"label": "Partner Jira", "kind": "poll", "every": 60, "target": "Tier-1 supplier defect feed"},
    "device": {"label": "hu-sentinel", "kind": "push", "every": None, "target": "in-vehicle bug bundles"},
}


def _mode(key: str) -> str:
    if key == "device":
        return "push"
    if key == "forum" or (key == "reddit" and settings.reddit_live):
        return "live"
    return "simulated"


_state: dict[str, dict] = {
    k: {"source": k, "label": v["label"], "kind": v["kind"], "mode": _mode(k), "target": v["target"], "interval": v["every"],
        "status": "listening" if v["kind"] == "push" else "idle", "last_checked": None, "next_check": None,
        "last_found": 0, "checks": 0, "error": None}
    for k, v in SOURCES.items()
}


def _publish_state(key: str) -> None:
    bus.publish("intake.source", None, source=dict(_state[key]))


def log(source: str | None, kind: str, text: str, **extra) -> dict:
    """Append an activity row. kind: check | found | triage | cluster | case | skip | error."""
    with _lock:
        row = {"id": next(_ids), "ts": now(), "source": source, "kind": kind, "text": text, "count": 1, **extra}
        _activity.append(row)
        if source:
            _idle_row.pop(source, None)
    bus.publish("intake.activity", None, entry=row)
    return row


def _log_empty(source: str, text: str) -> None:
    with _lock:
        row = _idle_row.get(source)
        if row is not None:
            row["ts"], row["count"], row["text"] = now(), row["count"] + 1, text
        else:
            row = {"id": next(_ids), "ts": now(), "source": source, "kind": "check", "text": text, "count": 1}
            _activity.append(row)
            _idle_row[source] = row
        out = dict(row)
    bus.publish("intake.activity", None, entry=out)


def due(key: str) -> bool:
    s = _state[key]
    return s["kind"] == "poll" and (s["next_check"] is None or now() >= s["next_check"])


def check(key: str, poll, scanned=None) -> list[Signal]:
    """Run one poll of a source with state and activity reporting. `scanned` describes what was looked at."""
    s = _state[key]
    s.update(status="checking", error=None)
    _publish_state(key)
    try:
        found = poll()
    except Exception as e:  # a failing source must not stop the sweep
        s.update(status="error", error=str(e)[:200], last_checked=now(), next_check=now() + (s["interval"] or 30))
        _publish_state(key)
        log(key, "error", f"Check of {s['target']} failed: {str(e)[:120]}")
        return []
    s.update(status="idle", last_checked=now(), next_check=now() + (s["interval"] or 30), last_found=len(found), checks=s["checks"] + 1)
    _publish_state(key)
    where = s["target"] + (f" · {scanned()}" if scanned else "")
    if found:
        log(key, "found", f"Found {len(found)} new {'report' if len(found) == 1 else 'reports'} on {where}")
    else:
        _log_empty(key, f"Checked {where} · nothing new")
    return found


def device_seen() -> None:
    s = _state["device"]
    s.update(last_checked=now(), checks=s["checks"] + 1, last_found=1)
    _publish_state("device")


def snapshot() -> dict:
    with _lock:
        return {"sources": [dict(v) for v in _state.values()], "activity": [dict(r) for r in reversed(_activity)]}


def reset() -> None:
    with _lock:
        _activity.clear()
        _idle_row.clear()
    for s in _state.values():
        s.update(last_checked=None, next_check=None, last_found=0, checks=0, error=None,
                 status="listening" if s["kind"] == "push" else "idle")

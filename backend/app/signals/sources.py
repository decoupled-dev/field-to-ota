"""Signal source crawlers.

Locally they run as a background poll loop; in aws mode each source is a Lambda on an
EventBridge Scheduler rule (forums via AgentCore Browser) posting to the same ingest path.
"""
from __future__ import annotations

import json
import logging
import httpx

from ..config import ROOT, settings
from ..models import Signal, SignalSource, now
from ..store import store

log = logging.getLogger("f2f.sources")
FIXTURES = ROOT / "data" / "fixtures" / "social.json"


def fixture_signals() -> list[Signal]:
    out = []
    for f in json.loads(FIXTURES.read_text()):
        out.append(Signal(source=SignalSource(f["source"]), external_id=f["external_id"], url=f["url"], author=f["author"],
                          title=f["title"], body=f["body"], created_at=now() - f["hours_ago"] * 3600))
    return out


def seed_forum() -> None:
    for f in json.loads(FIXTURES.read_text()):
        if f["source"] == "forum":
            store.put_doc("kv", f"forum:{f['external_id']}", {"id": f["external_id"], "author": f["author"], "title": f["title"],
                                                             "body": f["body"], "ts": now() - f["hours_ago"] * 3600, "crawled": True},
                          now() - f["hours_ago"] * 3600)


def poll_forum() -> list[Signal]:
    """The owners forum crawler: picks up posts it hasn't seen."""
    new = []
    for p in store.list_docs("kv", "forum:"):
        if p.get("crawled"):
            continue
        p["crawled"] = True
        store.put_doc("kv", f"forum:{p['id']}", p, p["ts"])
        new.append(Signal(source=SignalSource.forum, external_id=p["id"], url=f"/forum#{p['id']}", author=p["author"],
                          title=p["title"], body=p["body"], created_at=p["ts"]))
    return new


def poll_reddit() -> list[Signal]:
    if not settings.reddit_live:
        return []
    cursor = (store.get_doc("kv", "cursor:reddit") or {}).get("ts", now() - 7 * 86400)
    try:
        r = httpx.get("https://www.reddit.com/search.json", params={"q": settings.reddit_query, "sort": "new", "t": "week", "limit": 25},
                      headers={"User-Agent": "field-to-fix/0.1 (hackathon prototype)"}, timeout=10)
        r.raise_for_status()
    except Exception as e:
        log.warning("reddit poll failed: %s", e)
        return []
    out = []
    for child in r.json().get("data", {}).get("children", []):
        d = child["data"]
        if d["created_utc"] <= cursor:
            continue
        out.append(Signal(source=SignalSource.reddit, external_id=d["name"], url="https://www.reddit.com" + d["permalink"],
                          author=f"u/{d['author']}", title=d["title"], body=d.get("selftext", "")[:2000], created_at=d["created_utc"]))
    store.put_doc("kv", "cursor:reddit", {"ts": max([cursor] + [s.created_at for s in out])})
    return out


def poll_simulated(source: str) -> list[Signal]:
    """Simulated feeds replay the fixture file; anything already ingested is skipped, so steady state finds nothing."""
    seen = {(s.source.value, s.external_id) for s in store.list_signals()}
    return [s for s in fixture_signals() if s.source.value == source and (source, s.external_id) not in seen]


def _forum_posts() -> str:
    n = len(store.list_docs("kv", "forum:"))
    return f"{n} posts scanned"


POLLS = {
    "forum": (poll_forum, _forum_posts),
    "reddit": ((poll_reddit, None) if settings.reddit_live else (lambda: poll_simulated("reddit"), None)),
    "x": (lambda: poll_simulated("x"), None),
    "issuetracker": (lambda: poll_simulated("issuetracker"), None),
    "partner_jira": (lambda: poll_simulated("partner_jira"), None),
}


def crawl_loop(stop) -> None:
    from . import intake
    from .ingest import ingest
    while not stop.is_set():
        for key, (poll, scanned) in POLLS.items():
            if stop.is_set():
                break
            if not intake.due(key):
                continue
            try:
                for s in intake.check(key, poll, scanned):
                    ingest(s)
            except Exception:
                log.exception("crawl loop error (%s)", key)
        stop.wait(1)

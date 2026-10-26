"""Signal source crawlers.

Locally they run as a background poll loop; in aws mode each source is a Lambda on an
EventBridge Scheduler rule (forums via AgentCore Browser) posting to the same ingest path.
"""
from __future__ import annotations

import json
import logging
import time

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


def crawl_loop(stop) -> None:
    from .ingest import ingest
    last_reddit = 0.0
    while not stop.is_set():
        try:
            for s in poll_forum():
                ingest(s)
            if time.time() - last_reddit > 300:
                last_reddit = time.time()
                for s in poll_reddit():
                    ingest(s)
        except Exception:
            log.exception("crawl loop error")
        stop.wait(3)

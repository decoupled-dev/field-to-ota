"""The Field Discovery Agent orchestrator.

Cycle:
  1. Crawl every source for the configured OEM/models.
  2. Classify each complaint (Bedrock or offline) — keep only genuine software issues for this OEM.
  3. Dedupe against what we've already reported.
  4. POST each kept complaint to the app's /api/signals, so the app clusters it and opens a case.
  5. Optionally force-open a case via /api/clusters/{id}/promote when DISCOVERY_PROMOTE=1.
"""
from __future__ import annotations

import logging
import time

import httpx

from .. import llm
from ..config import settings
from . import sources
from .classifier import classify
from .model import Complaint

log = logging.getLogger("f2f.discovery.agent")


class DiscoveryAgent:
    def __init__(self, oem: str | None = None, models: list[str] | None = None,
                 app_url: str | None = None, since_days: int | None = None,
                 promote: bool | None = None, in_process: bool = False):
        self.oem = oem or settings.discovery_oem
        self.models = models if models is not None else settings.discovery_models
        self.app_url = (app_url or settings.discovery_app_url).rstrip("/")
        self.since_days = since_days if since_days is not None else settings.discovery_since_days
        self.promote = settings.discovery_promote if promote is None else promote
        # in_process=True reports straight into the signal pipeline (same process as the app),
        # avoiding an HTTP round-trip to ourselves. Used by the /api/discovery/run endpoint.
        self.in_process = in_process
        self._seen: set[str] = set()   # external ids already reported this process

    # -- one full cycle --------------------------------------------------------------------
    def cycle(self) -> dict:
        found: list[Complaint] = []
        source_summary: list[dict] = []
        for fn in sources.ALL_SOURCES:
            try:
                items = fn(self.oem, self.models, self.since_days)
            except Exception as e:  # noqa: BLE001
                log.warning("source %s raised: %s", fn.__name__, e)
                items = []
            found.extend(items)
            if items:
                source_summary.append({"source": fn.__name__, "count": len(items),
                                       "simulated": all(i.simulated for i in items)})

        kept: list[dict] = []
        reported = 0
        for c in found:
            sid = c.stable_id()
            if sid in self._seen:
                continue
            verdict = classify(c, self.oem)
            if not (verdict["is_issue"] and verdict["is_oem_match"]):
                continue
            self._seen.add(sid)
            posted = self._report(c, verdict)
            kept.append({"id": sid, "title": c.title, "source": c.source_name,
                         "severity": verdict["severity"], "via": verdict["via"],
                         "posted": bool(posted)})
            if posted:
                reported += 1

        result = {
            "oem": self.oem, "models": self.models,
            "crawled": len(found), "reported": reported,
            "llm": llm.mode(),
            "sources": source_summary,
            "issues": kept,
        }
        log.info("discovery cycle: crawled=%d reported=%d via=%s", len(found), reported, llm.mode())
        return result

    # -- ping the app ----------------------------------------------------------------------
    def _report(self, c: Complaint, verdict: dict) -> dict | None:
        payload = {
            "source": c.signal_source(),
            "title": c.title[:200],
            "body": (c.body or "")[:4000],
            "author": c.author or c.source_name,
            "url": c.url,
            "external_id": c.stable_id(),
        }
        if self.in_process:
            return self._report_in_process(payload)
        return self._report_http(payload)

    def _report_http(self, payload: dict) -> dict | None:
        try:
            with httpx.Client(timeout=20.0) as client:
                r = client.post(f"{self.app_url}/api/signals", json=payload)
                r.raise_for_status()
                sig = r.json()
                cluster_id = sig.get("cluster_id")
                if self.promote and cluster_id and not sig.get("case_id"):
                    try:
                        client.post(f"{self.app_url}/api/clusters/{cluster_id}/promote")
                    except httpx.HTTPError as e:
                        log.info("promote failed for %s: %s", cluster_id, e)
                return sig
        except httpx.HTTPError as e:
            log.warning("could not report '%s' to app: %s", payload["title"][:60], e)
            return None

    def _report_in_process(self, payload: dict) -> dict | None:
        """Report by calling the signal pipeline directly (no HTTP)."""
        from ..models import Signal, SignalSource
        from ..signals.ingest import ingest, open_case
        from ..store import store
        try:
            src = SignalSource(payload["source"])
            # Skip if the app already has this external_id (keeps the reported count honest).
            if payload["external_id"] and any(
                s.external_id == payload["external_id"] and s.source == src for s in store.list_signals()):
                return None
            sig = ingest(Signal(source=src, title=payload["title"], body=payload["body"],
                                author=payload["author"], url=payload["url"],
                                external_id=payload["external_id"]))
            if self.promote and sig.cluster_id and not sig.case_id:
                c = store.get_doc("clusters", sig.cluster_id)
                if c and not c.get("case_id"):
                    open_case(c, "promoted by the Field Discovery Agent")
            return sig.model_dump(mode="json")
        except Exception as e:  # noqa: BLE001
            log.warning("in-process report failed for '%s': %s", payload["title"][:60], e)
            return None


def run_once(**kw) -> dict:
    return DiscoveryAgent(**kw).cycle()


def run_forever(stop=None, **kw) -> None:
    agent = DiscoveryAgent(**kw)
    log.info("Field Discovery Agent started: oem=%s models=%s app=%s interval=%ss promote=%s",
             agent.oem, agent.models, agent.app_url, settings.discovery_interval, agent.promote)
    while stop is None or not stop.is_set():
        try:
            agent.cycle()
        except Exception as e:  # noqa: BLE001
            log.exception("discovery cycle failed: %s", e)
        waited = 0
        while (stop is None or not stop.is_set()) and waited < settings.discovery_interval:
            time.sleep(1)
            waited += 1
        if stop is None:
            # No stop event: single-shot guard so importing never blocks a process unexpectedly.
            if settings.discovery_interval <= 0:
                break

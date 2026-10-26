"""Field-to-Fix console API.

    uvicorn backend.app.main:app --port 8000      (from the repo root)
"""
from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import tarfile
import threading
import time
from collections import Counter
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import fleetdata, llm, seed, signing
from .bus import bus
from .config import ROOT, settings
from .connectors.registry import catalog
from .models import Case, CaseStatus, Signal, SignalSource, now
from .pipeline import runner
from .reports.render import REPORTS, _env, render
from .signals import cluster as clustering
from .signals.ingest import ingest, open_case
from .signals.sources import crawl_loop
from .stages import STAGES
from .store import store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("f2f")
_stop = threading.Event()


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus.bind(asyncio.get_running_loop())
    signing.ensure_keys()
    seed.ensure_seeded()
    for c in store.list_cases():  # a restart interrupts running pipelines; mark them so the UI doesn't spin forever
        if c.status in (CaseStatus.running, CaseStatus.awaiting_approval, CaseStatus.releasing):
            c.status = CaseStatus.failed
            store.put_case(c)
    threading.Thread(target=crawl_loop, args=(_stop,), daemon=True, name="crawlers").start()
    log.info("Field-to-Fix console up: mode=%s llm=%s", settings.mode, llm.mode())
    yield
    _stop.set()


app = FastAPI(title="Field-to-Fix", version="0.1.0", lifespan=lifespan)


# System ------------------------------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"mode": settings.mode, "llm": llm.mode(), "version": app.version}


@app.get("/api/stages")
def stages():
    return [s.model_dump() for s in STAGES]


@app.get("/api/integrations")
def integrations():
    return catalog()


@app.post("/api/demo/reset")
def demo_reset():
    seed.reset()
    bus.publish("demo.reset")
    return {"ok": True}


@app.get("/api/overview")
def overview():
    cases = store.list_cases()
    sigs = store.list_signals()
    closed = [c for c in cases if c.status == CaseStatus.closed and c.closed_at]
    mttr = round(sum((c.closed_at - c.created_at) / 60 for c in closed) / len(closed), 1) if closed else None
    t_now = now()
    buckets = {}
    for h in range(48, -1, -3):
        buckets[h] = {"t": t_now - h * 3600, **{s.value: 0 for s in SignalSource}}
    for s in sigs:
        age_h = (t_now - s.created_at) / 3600
        if age_h <= 48:
            key = min(buckets, key=lambda h: abs(h - age_h) if h >= age_h - 3 else 999)
            buckets[key][s.source.value] += 1
    return {
        "kpis": {"open_cases": sum(c.status != CaseStatus.closed for c in cases), "closed_cases": len(closed), "mttr_minutes": mttr,
                 "vehicles_affected": sum(c.affected_vins for c in cases), "vehicles_fixed": sum(c.fixed_vins for c in cases),
                 "signals_24h": sum(t_now - s.created_at < 86400 for s in sigs)},
        "signals_by_source": [{"source": k, "count": v} for k, v in Counter(s.source.value for s in sigs).most_common()],
        "signals_timeline": list(buckets.values()),
        "cases": [c.model_dump(mode="json") | {"stages": [{"stage": r.stage, "status": r.status.value} for r in store.list_stages(c.id)]}
                  for c in cases],
    }


# Signals -----------------------------------------------------------------------------------------
class SignalIn(BaseModel):
    source: SignalSource
    title: str
    body: str = ""
    author: str | None = None
    url: str | None = None
    external_id: str | None = None


@app.get("/api/signals")
def list_signals(source: str | None = None, case_id: str | None = None):
    return [s for s in store.list_signals() if (not source or s.source.value == source) and (not case_id or s.case_id == case_id)]


@app.post("/api/signals")
def post_signal(body: SignalIn):
    return ingest(Signal(**body.model_dump()))


@app.get("/api/clusters")
def clusters():
    return [clustering.public(c) for c in store.list_docs("clusters")]


@app.post("/api/clusters/{cid}/promote")
def promote(cid: str):
    c = store.get_doc("clusters", cid)
    if not c:
        raise HTTPException(404)
    if c.get("case_id"):
        return store.get_case(c["case_id"])
    return open_case(c, "promoted manually from the Signals inbox")


# Cases -------------------------------------------------------------------------------------------
@app.get("/api/cases")
def list_cases():
    return store.list_cases()


@app.get("/api/cases/{case_id}")
def get_case(case_id: str):
    case = store.get_case(case_id)
    if not case:
        raise HTTPException(404)
    return {"case": case, "stages": store.list_stages(case_id),
            "signals": [s for s in (store.get_signal(i) for i in case.signal_ids) if s]}


class Decision(BaseModel):
    approver: str = "Release owner"
    comment: str = ""


@app.post("/api/cases/{case_id}/approve")
def approve(case_id: str, d: Decision):
    if not runner.decide(case_id, True, d.approver, d.comment):
        raise HTTPException(409, "case is not awaiting approval")
    return store.get_case(case_id)


@app.post("/api/cases/{case_id}/reject")
def reject(case_id: str, d: Decision):
    if not runner.decide(case_id, False, d.approver, d.comment):
        raise HTTPException(409, "case is not awaiting approval")
    return store.get_case(case_id)


@app.post("/api/cases/{case_id}/rerun")
def rerun(case_id: str):
    case = store.get_case(case_id)
    if not case:
        raise HTTPException(404)
    runner.init_stages(case)
    runner.start(case)
    return case


@app.get("/api/cases/{case_id}/fleet")
def case_fleet(case_id: str):
    case = store.get_case(case_id)
    if not case:
        raise HTTPException(404)
    imp = fleetdata.impact()
    rollout = store.get_doc("kv", f"rollout:{case_id}") or {}
    devices = rollout.get("devices", {})
    cohort_vins = set((store.get_doc("kv", f"cohort:{case_id}") or {}).get("vins", []))
    cohort = []
    for v in imp["affected"]:
        if v["vin"] not in cohort_vins:
            continue
        status = devices.get(v["vin"], {}).get("status", "NOT_TARGETED")
        updated = status == "SUCCEEDED"
        cohort.append({"vin": v["vin"], "thing": v["thing"], "region": v["region"], "min_temp_c": v["min_temp_c"],
                       "sw_version": case.fixed_version if updated else v["sw_version"],
                       "underruns": 0 if updated else v["underruns_per_boot"], "ota_status": status, "real": v["thing"] == "hu-demo-001"})
    health = sorted(store.list_docs("kv", "devhealth:hu-demo-001:"), key=lambda h: h["ts"])[-40:]
    return {"total_vins": imp["total_vins"], "affected_vins": len(cohort), "cohort": cohort, "by_region": imp["by_region"],
            "by_version": imp["by_version"], "by_temp": imp["by_temp"],
            "rollout": {k: v for k, v in rollout.items() if k != "devices"},
            "health": [{"t": h["ts"], "underruns": h["metrics"].get("underruns", 0), "a2dp_reconnects": h["metrics"].get("a2dp_reconnects", 0),
                        "sw_version": h.get("sw_version")} for h in health]}


@app.get("/api/cases/{case_id}/reports")
def case_reports(case_id: str):
    return [{"type": k, "title": t, "description": d, "url": f"/api/cases/{case_id}/reports/{k}"} for k, (t, d) in REPORTS.items()]


@app.get("/api/cases/{case_id}/reports/{kind}", response_class=HTMLResponse)
def case_report(case_id: str, kind: str):
    html = render(case_id, kind)
    if html is None:
        raise HTTPException(404)
    return html


# Events ------------------------------------------------------------------------------------------
async def _stream(request: Request, case_id: str | None):
    q = bus.subscribe()
    try:
        yield {"event": "ready", "data": "{}"}
        while not await request.is_disconnected():
            try:
                ev = await asyncio.wait_for(q.get(), timeout=15)
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "{}"}
                continue
            if case_id is None or ev.get("case_id") == case_id:
                yield {"data": json.dumps(ev)}
    finally:
        bus.unsubscribe(q)


@app.get("/api/events")
async def events(request: Request):
    return EventSourceResponse(_stream(request, None))


@app.get("/api/cases/{case_id}/events")
async def case_events(request: Request, case_id: str):
    return EventSourceResponse(_stream(request, case_id))


@app.get("/api/artifacts/{path:path}")
def artifact(path: str):
    p = (settings.artifacts_dir / path).resolve()
    if not p.is_relative_to(settings.artifacts_dir.resolve()) or not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


# Device plane (hu-sentinel) ----------------------------------------------------------------------
_RULE_TITLES = {"BT_AUDIO_UNDERRUN": "Bluetooth audio stutter and A2DP disconnect at cold start",
                "APP_ANR": "Application not responding on head unit", "NATIVE_CRASH": "Native crash on head unit"}
MAX_BUNDLE = 25 * 1024 * 1024


@app.post("/api/device/events")
async def device_event(meta: str = Form(...), bundle: UploadFile | None = File(None)):
    m = json.loads(meta)
    sig = Signal(source=SignalSource.device, external_id=f"{m.get('thing')}:{m.get('rule_id')}:{int(m.get('ts', now()))}",
                 author=m.get("vin"), vin=m.get("vin"), rule_id=m.get("rule_id"), severity=m.get("severity"),
                 sw_version=(m.get("sw_version") or "").removeprefix("HU-") or None, metrics=m.get("metrics") or {},
                 title=f"hu-sentinel · {_RULE_TITLES.get(m.get('rule_id'), m.get('rule_id'))}", body=m.get("summary", ""),
                 created_at=float(m.get("ts") or now()))
    if bundle is not None:
        data = await bundle.read(MAX_BUNDLE + 1)
        if len(data) > MAX_BUNDLE:
            raise HTTPException(413, "bundle too large")
        d = settings.artifacts_dir / "devices" / sig.id
        d.mkdir(parents=True, exist_ok=True)
        (d / "bundle.tar.gz").write_bytes(data)
        sig.bundle_key = f"devices/{sig.id}/bundle.tar.gz"
        try:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
                member = next((x for x in tar.getmembers() if x.name.lstrip("./") == "logs_60s.txt" and x.isfile()), None)
                if member:
                    logs = tar.extractfile(member).read(2_000_000).decode(errors="replace")
                    (d / "logs_60s.txt").write_text(logs)
                    amb = re.findall(r"ambient=(-?\d+(?:\.\d+)?)C", logs)
                    if amb:
                        sig.metrics["ambient_c"] = float(amb[-1])
                    key_lines = [l for l in logs.splitlines() if re.search(r" [WE] (A2dpManager|BluetoothA2dp|CarProjection)", l)]
                    sig.body = (sig.body + "\n" + "\n".join(key_lines[:6])).strip()
        except tarfile.TarError as e:
            log.warning("unreadable bundle from %s: %s", m.get("thing"), e)
    if "ambient_c" in sig.metrics and sig.metrics["ambient_c"] < 0:
        sig.conditions = ["cold-start", "sub-zero ambient"]
    return ingest(sig)


def _jobs(thing: str) -> list[dict]:
    return store.list_docs("kv", f"job:{thing}:")


@app.get("/api/device/{thing}/jobs/next")
def next_job(thing: str):
    pending = [j for j in _jobs(thing) if j["status"] not in ("SUCCEEDED", "FAILED", "CANCELED")]
    if not pending:
        return Response(status_code=204)
    j = pending[0]
    return {"job_id": j["job_id"], "document": j["document"]}


class JobStatus(BaseModel):
    status: str
    details: dict = {}


@app.post("/api/device/{thing}/jobs/{job_id}")
def job_status(thing: str, job_id: str, s: JobStatus):
    key = f"job:{thing}:{job_id}"
    j = store.get_doc("kv", key)
    if not j:
        raise HTTPException(404)
    j["status"], j["details"] = s.status, s.details
    store.put_doc("kv", key, j)
    bus.publish("device.job", None, thing=thing, job_id=job_id, status=s.status)
    return j


@app.post("/api/device/{thing}/health")
async def device_health(thing: str, request: Request):
    h = await request.json()
    h.setdefault("ts", now())
    store.put_doc("kv", f"devhealth:{thing}:{h['ts']:.3f}", h | {"thing": thing}, h["ts"])
    bus.publish("device.health", None, thing=thing, health=h)
    return {"ok": True}


@app.get("/api/jobs/{job_id}")
def job(job_id: str):
    return [j for j in store.list_docs("kv", "job:") if j["job_id"] == job_id]


# Mock forum + simulated tool pages ---------------------------------------------------------------
@app.get("/forum", response_class=HTMLResponse)
def forum():
    posts = sorted(store.list_docs("kv", "forum:"), key=lambda p: -p["ts"])
    replies: dict[str, list] = {}
    for r in store.list_docs("kv", "forumreply:"):
        replies.setdefault(r["post_id"], []).append(r)
    return _env.get_template("forum.html").render(posts=posts, replies=replies)


@app.post("/forum/posts")
def forum_post(author: str = Form(...), title: str = Form(...), body: str = Form(...)):
    _forum_add(author, title, body)
    return RedirectResponse("/forum", status_code=303)


class ForumPost(BaseModel):
    author: str
    title: str
    body: str


@app.get("/api/forum/posts")
def forum_posts():
    return sorted(store.list_docs("kv", "forum:"), key=lambda p: -p["ts"])


@app.post("/api/forum/posts")
def forum_post_json(p: ForumPost):
    return _forum_add(p.author, p.title, p.body)


def _forum_add(author: str, title: str, body: str) -> dict:
    pid = f"dt-{8800 + len(store.list_docs('kv', 'forum:')) + 20}"
    doc = {"id": pid, "author": author[:60], "title": title[:200], "body": body[:4000], "ts": now(), "crawled": False}
    store.put_doc("kv", f"forum:{pid}", doc, doc["ts"])
    return doc


@app.get("/tools/issues/{key}", response_class=HTMLResponse)
def tool_issue(key: str):
    issue = store.get_doc("kv", f"issue:{key}")
    if not issue:
        raise HTTPException(404)
    case = next((c for c in store.list_cases() if any(l.label == key for l in c.links)), Case(title=issue["title"]))
    return _env.get_template("tool_issue.html").render(issue=issue, case=case, title=f"{key} · {issue['title']}",
                                                       generated=time.strftime("%Y-%m-%d %H:%M"))


@app.get("/tools/pulls/{branch:path}", response_class=HTMLResponse)
def tool_pr(branch: str):
    pr = store.get_doc("kv", f"pr:{branch}")
    if not pr:
        raise HTTPException(404)
    case = store.get_case(pr["case_id"]) or Case(title=pr["title"])
    return _env.get_template("tool_pr.html").render(pr=pr, case=case, title=pr["title"], generated=time.strftime("%Y-%m-%d %H:%M"))


# SPA ---------------------------------------------------------------------------------------------
DIST = ROOT / "frontend" / "dist"


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = (DIST / path).resolve()
    if path and f.is_relative_to(DIST.resolve()) and f.is_file():
        return FileResponse(f)
    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index)
    return HTMLResponse("<p>Frontend not built. Run <code>npm run build</code> in frontend/.</p>")

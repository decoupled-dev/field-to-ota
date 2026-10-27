"""Intake for the AAOS issue-daemon (github.com/decoupled-dev/issue-daemon).

The daemon speaks its own "ECU server" protocol:
    POST /api/v1/issues     multipart/form-data: metadata (JSON) + bundle (zip)
    POST /api/v1/heartbeat  application/json
This module turns each report into a device Signal (same path as hu-sentinel's /api/device/events)
and, for crashes of a registered app (device_apps.py), opens a case right away: one crash report
from a vehicle is enough evidence, so the cluster threshold for public reports does not apply.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import zipfile

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile

from . import device_apps
from .bus import bus
from .config import settings
from .models import Signal, SignalSource, now
from .signals.ingest import ingest, open_case
from .store import store

log = logging.getLogger("f2f.issue_daemon")
router = APIRouter()

MAX_BUNDLE = 25 * 1024 * 1024
MAX_LOG = 2_000_000
_SEVERITY = {"CRITICAL": "critical", "ERROR": "high", "WARNING": "medium", "INFO": "low"}
_CRASH_TYPES = {"APP_CRASH", "NATIVE_CRASH", "ANR", "OUT_OF_MEMORY"}
_EXCEPTION = re.compile(r"^\s*((?:[\w$]+\.)+[\w$]*(?:Exception|Error)\b[^\n]*)", re.M)


def _check_auth(authorization: str | None) -> None:
    key = os.environ.get("F2F_DEVICE_API_KEY")
    if key and authorization != f"Bearer {key}":
        raise HTTPException(401, "bad or missing device API key")


def _log_excerpt(z: zipfile.ZipFile) -> str:
    """Crash evidence first (what the monitor captured), then the crash buffer, then recent logcat."""
    parts: list[str] = []
    names = z.namelist()
    for n in [n for n in names if n.startswith("attachments/")] + ["logcat/crash.txt", "logcat/all.txt"]:
        if n not in names:
            continue
        text = z.read(n)[:MAX_LOG].decode(errors="replace")
        if n == "logcat/all.txt":
            text = "\n".join(text.splitlines()[-400:])
        parts.append(f"===== {n} =====\n{text.strip()}")
    return "\n\n".join(parts)


def _exception(text: str) -> str | None:
    m = _EXCEPTION.search(text)
    return m.group(1).strip()[:200] if m else None


@router.post("/api/v1/issues")
async def issue_report(metadata: str = Form(...), bundle: UploadFile | None = File(None),
                       authorization: str | None = Header(None), x_device_id: str | None = Header(None)):
    _check_auth(authorization)
    try:
        meta = json.loads(metadata)
    except json.JSONDecodeError:
        raise HTTPException(400, "metadata is not JSON")
    issue, device = meta.get("issue") or {}, meta.get("device") or {}
    itype = issue.get("type", "UNKNOWN")
    process = issue.get("process")
    thing = device.get("device_id") or x_device_id or "unknown-device"
    app = device_apps.for_process(process)
    ts = (issue.get("timestamp_ms") or meta.get("created_at_ms") or now() * 1000) / 1000

    sig = Signal(source=SignalSource.device, external_id=f"issue-daemon:{meta.get('report_id') or issue.get('id')}",
                 author=device.get("vin") or thing, vin=device.get("vin") or thing, rule_id=itype,
                 severity=_SEVERITY.get(issue.get("severity", ""), "medium"),
                 title=f"issue-daemon · {issue.get('title') or itype}", body=(issue.get("details") or "")[:8000],
                 created_at=ts, component=app.get("component") if app else None,
                 sw_version=app.get("version") if app else None,
                 is_bug=True if itype in _CRASH_TYPES else None,
                 metrics={"process": process, "issue_type": itype, "thing": thing, "model": device.get("model"),
                          "fingerprint": device.get("fingerprint"), "sdk_int": device.get("sdk_int"),
                          "suppressed_since_last_report": meta.get("suppressed_since_last_report", 0),
                          "health": meta.get("health") or {}, "attributes": issue.get("attributes") or {}})

    if bundle is not None:
        data = await bundle.read(MAX_BUNDLE + 1)
        if len(data) > MAX_BUNDLE:
            raise HTTPException(413, "bundle too large")
        d = settings.artifacts_dir / "devices" / sig.id
        d.mkdir(parents=True, exist_ok=True)
        (d / "bundle.zip").write_bytes(data)
        sig.bundle_key = f"devices/{sig.id}/bundle.zip"
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                logs = _log_excerpt(z)
            (d / "logs_60s.txt").write_text(logs)  # name expected by Detect / log RCA
            exc = _exception(sig.body) or _exception(logs)
            if exc:
                sig.metrics["exception"] = exc
        except zipfile.BadZipFile as e:
            log.warning("unreadable bundle from %s: %s", thing, e)

    sig = ingest(sig)
    case_id = sig.case_id
    if app and app.get("auto_open_case", True) and itype in _CRASH_TYPES and sig.cluster_id and not case_id:
        c = store.get_doc("clusters", sig.cluster_id)
        if c and not c.get("case_id"):
            case = open_case(c, f"issue-daemon on {thing} reported {itype} in {process}")
            case_id = case.id
    log.info("issue-daemon %s from %s (%s) → signal %s case %s", itype, thing, process, sig.id, case_id)
    return {"accepted": True, "signal_id": sig.id, "cluster_id": sig.cluster_id, "case_id": case_id}


@router.post("/api/v1/heartbeat")
async def heartbeat(request: Request, authorization: str | None = Header(None), x_device_id: str | None = Header(None)):
    _check_auth(authorization)
    h = await request.json()
    thing = (h.get("device") or {}).get("device_id") or h.get("device_id") or x_device_id or "unknown-device"
    h["ts"] = now()
    store.put_doc("kv", f"devhealth:{thing}:{h['ts']:.3f}", h | {"thing": thing, "source": "issue-daemon"}, h["ts"])
    bus.publish("device.health", None, thing=thing, health=h)
    return {"ok": True}

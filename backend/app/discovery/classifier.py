"""Classify a discovered complaint: is it a genuine software/infotainment issue for this OEM?

Uses Bedrock (Claude via the Converse API) when credentials are present; otherwise a deterministic
keyword analyzer. Either way it returns the same shape so the agent treats both uniformly.
"""
from __future__ import annotations

import logging

from .. import llm
from .model import Complaint

log = logging.getLogger("f2f.discovery.classifier")

_SOFTWARE_WORDS = {
    "software", "firmware", "update", "ota", "infotainment", "uconnect", "screen", "display",
    "bluetooth", "android auto", "carplay", "navigation", "nav", "freeze", "reboot", "crash",
    "glitch", "lag", "connectivity", "head unit", "radio", "app", "stutter", "disconnect",
}
_SEVERITY = {"low", "medium", "high", "critical"}

_SYS = (
    "You are a field-intelligence analyst for an automotive OEM. You decide whether an owner "
    "complaint describes a genuine SOFTWARE / infotainment (IVI) defect for the given OEM, and "
    "how severe it is. Ignore hardware-only issues, general reviews, and off-topic chatter."
)


def classify(c: Complaint, oem: str) -> dict:
    """Return {is_issue: bool, is_oem_match: bool, severity: str, component: str|None,
    reason: str, via: 'bedrock'|'offline'}."""
    if llm.available():
        out = _classify_bedrock(c, oem)
        if out is not None:
            return out
    return _classify_offline(c, oem)


def _classify_bedrock(c: Complaint, oem: str) -> dict | None:
    prompt = (
        f"OEM of interest: {oem}\n"
        f"Source: {c.source_name} ({c.source_kind})\n"
        f"Title: {c.title}\n"
        f"Body: {c.body[:1500]}\n\n"
        "Return JSON with keys: is_issue (bool, true only for a real software/IVI defect), "
        "is_oem_match (bool, true if this plausibly concerns the OEM's vehicles), "
        "severity (one of low|medium|high|critical), component (short string or null), "
        "reason (one sentence)."
    )
    data = llm.complete_json(_SYS, prompt, max_tokens=400)
    if not data:
        return None
    return {
        "is_issue": bool(data.get("is_issue")),
        "is_oem_match": bool(data.get("is_oem_match", True)),
        "severity": data.get("severity") if data.get("severity") in _SEVERITY else "medium",
        "component": data.get("component") or None,
        "reason": str(data.get("reason", ""))[:300],
        "via": "bedrock",
    }


def _classify_offline(c: Complaint, oem: str) -> dict:
    blob = f"{c.title} {c.body}".lower()
    hits = {w for w in _SOFTWARE_WORDS if w in blob}
    is_issue = len(hits) >= 1
    # OEM match: brand/model words, or the source is an OEM-specific channel, or seed-labelled.
    oem_terms = {oem.lower(), "jeep", "dodge", "ram", "chrysler", "uconnect", "wagoneer", "pacifica"} if oem.lower() == "stellantis" else {oem.lower()}
    is_oem = c.simulated or any(t in blob or t in (c.source_name or "").lower() for t in oem_terms)
    sev = c.extra.get("severity")
    if sev not in _SEVERITY:
        sev = "high" if {"crash", "freeze", "reboot", "stuck"} & hits else ("medium" if is_issue else "low")
    return {
        "is_issue": is_issue,
        "is_oem_match": is_oem,
        "severity": sev,
        "component": _guess_component(blob),
        "reason": ("matched software terms: " + ", ".join(sorted(hits))) if hits else "no software terms found",
        "via": "offline",
    }


def _guess_component(blob: str) -> str | None:
    if any(w in blob for w in ("bluetooth", "a2dp", "audio", "android auto", "carplay")):
        return "media-service"
    if any(w in blob for w in ("navigation", "nav", "map", "gps")):
        return "navigation"
    if any(w in blob for w in ("camera", "rear view", "backup")):
        return "camera"
    if any(w in blob for w in ("screen", "display", "hmi", "touch")):
        return "hmi"
    return None

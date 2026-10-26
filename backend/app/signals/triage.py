"""Signal triage: is it a bug, which component, which SW version, under which conditions."""
from __future__ import annotations

import re

from .. import llm
from ..models import Signal

_COMPONENTS = {
    "media-service": ["bluetooth", "a2dp", "audio", "spotify", "podcast", "music", "crackl", "stutter", "android auto", "underrun"],
    "navigation": ["nav", "reroute", "gps", "map"],
    "camera": ["camera", "reverse", "parking"],
    "hmi": ["home screen", "widget", "layout"],
}
_BUG_WORDS = ["stutter", "crackl", "drop", "disconnect", "cuts", "underrun", "crash", "freez", "lag", "reroute", "stall",
              "not work", "issue", "bug", "fix", "broken", "fail"]
_COND = {"cold-start": ["cold start", "after start", "right after ignition", "after i start", "after boot", "early boot", "cold morning", "every morning"],
         "sub-zero ambient": ["below freezing", "-10c", "-8c", "-5c", "< 0c", "frost", "freez", "cold chamber", "winter"],
         "after SW update": ["since the latest", "since the head unit updated", "since hu", "latest update", "updated to"]}

SYSTEM = ("You triage automotive field reports for an OEM head-unit team. Extract: is_bug (bool), component "
          "(one of media-service, navigation, camera, hmi, other), sw_version (like 2.3.1 or null), conditions (list of short tags), "
          "severity (low|medium|high|critical), and vehicle_model or null.")


def triage(sig: Signal) -> Signal:
    text = f"{sig.title}\n{sig.body}"
    out = llm.complete_json(SYSTEM, text, max_tokens=400) if sig.source != "device" else None
    if out:
        sig.is_bug = bool(out.get("is_bug"))
        sig.component = out.get("component") or None
        sig.sw_version = out.get("sw_version") or _version(text)
        sig.conditions = list(out.get("conditions") or [])
        sig.severity = out.get("severity") or "medium"
        sig.vehicle_model = out.get("vehicle_model")
        return sig
    low = text.lower()
    scores = {c: sum(k in low for k in kws) for c, kws in _COMPONENTS.items()}
    comp, score = max(scores.items(), key=lambda kv: kv[1])
    sig.component = sig.component or (comp if score else "other")
    sig.is_bug = sig.is_bug if sig.is_bug is not None else any(w in low for w in _BUG_WORDS)
    sig.sw_version = sig.sw_version or _version(text)
    sig.conditions = sig.conditions or [c for c, kws in _COND.items() if any(k in low for k in kws)]
    if not sig.severity:
        sig.severity = "high" if sig.is_bug and ("disconnect" in low or "drop" in low or "stall" in low) else ("medium" if sig.is_bug else "low")
    return sig


def _version(text: str) -> str | None:
    m = re.search(r"(?:HU[- ]?)?(\d+\.\d+\.\d+)", text, re.I)
    return m.group(1) if m else None

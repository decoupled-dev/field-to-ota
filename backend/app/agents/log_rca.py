"""Log-focused Root Cause Analysis.

Gathers the log evidence available for a case — the on-vehicle hu-sentinel bundle (logs_60s.txt),
the reproduce stage's replay boot log, and the text of the field signals — extracts structured
features from it, and asks Claude (Bedrock Converse) for an evidenced root cause. Falls back to a
deterministic log analyzer when Bedrock is unavailable, so the demo runs offline.

Scope: logs only (audio/video deferred).
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .. import llm
from ..config import settings
from ..models import Signal

# Log line shapes we understand:
#   hu-sentinel / Android-style:  "+  123 ms W A2dpManager: audio HAL not ready after 200ms"
#   generic level-tagged:          "2026-01-01 W BluetoothA2dp: stall detected"
_LEVELS = {"E": "error", "W": "warn", "F": "fatal", "ERROR": "error", "WARN": "warn", "FATAL": "fatal"}
_LINE_RE = re.compile(r"(?P<lvl>\b[EWFI]\b|ERROR|WARN|FATAL|INFO)\s+(?P<tag>[A-Za-z0-9_./-]+)\s*:\s*(?P<msg>.*)")
_TS_MS_RE = re.compile(r"\+?\s*(\d+)\s*ms")
_TEMP_RE = re.compile(r"ambient=(-?\d+(?:\.\d+)?)\s*C", re.I)

# Symptom vocabulary → a candidate failure domain. Used by the offline analyzer and to pre-focus the LLM.
_SYMPTOMS = {
    "audio_underrun": ("underrun", "xrun", "buffer starved", "audioflinger"),
    "bt_stall": ("a2dp", "stall", "bluetooth", "sink disconnected"),
    "hal_timeout": ("hal not ready", "timeout", "not ready after", "deadline"),
    "reconnect": ("reconnect", "re-connect", "session lost", "projection"),
    "crash": ("segfault", "sigsegv", "fatal exception", "anr", "watchdog"),
    "oom": ("out of memory", "oom", "lowmemorykiller"),
    "boot_slow": ("boot", "cold start", "startup", "init took"),
}


@dataclass
class LogEvidence:
    """Structured features extracted from all available log text for a case."""

    sources: list[str] = field(default_factory=list)       # which logs were found
    total_lines: int = 0
    error_lines: list[str] = field(default_factory=list)
    warn_lines: list[str] = field(default_factory=list)
    top_tags: list[tuple[str, int]] = field(default_factory=list)
    symptoms: list[str] = field(default_factory=list)
    ambient_c: float | None = None
    first_error_ms: int | None = None
    raw: str = ""                                          # concatenated log text (bounded)


def collect_logs(case_id: str, signals: list[Signal], shared: dict) -> tuple[str, list[str]]:
    """Return (concatenated log text, list of source labels) from every log we can find."""
    chunks: list[str] = []
    sources: list[str] = []

    # 1. hu-sentinel device bundle log excerpt written during /api/device/events intake.
    for s in signals:
        if s.bundle_key:
            excerpt = settings.artifacts_dir / Path(s.bundle_key).parent / "logs_60s.txt"
            if excerpt.exists():
                chunks.append(f"### hu-sentinel logs_60s.txt (vin={s.vin}) ###\n" + excerpt.read_text(errors="replace"))
                sources.append(f"device bundle ({s.vin})")

    # 2. The reproduce stage's simulated boot log (events list), if present in shared scratch.
    repro = shared.get("repro") or {}
    events = repro.get("events") or []
    if events:
        lines = [f"+{t:>5} ms {lvl} {tag}: {msg}" for t, lvl, tag, msg in events]
        chunks.append("### replay boot log (reproduce stage) ###\n" + "\n".join(lines))
        sources.append("replay boot log")

    # 3. Field signal bodies (owner reports often paste log snippets / symptoms).
    sig_text = "\n".join(f"[{s.source.value}] {s.title}\n{s.body}" for s in signals if s.body)
    if sig_text.strip():
        chunks.append("### field signal reports ###\n" + sig_text)
        sources.append("field reports")

    return ("\n\n".join(chunks))[:24000], sources


def extract(log_text: str, sources: list[str]) -> LogEvidence:
    ev = LogEvidence(sources=sources, raw=log_text)
    tags: Counter = Counter()
    lower = log_text.lower()

    for raw_line in log_text.splitlines():
        ev.total_lines += 1
        m = _LINE_RE.search(raw_line)
        if not m:
            continue
        level = _LEVELS.get(m.group("lvl").upper(), "info")
        tag = m.group("tag")
        tags[tag] += 1
        if level in ("error", "fatal"):
            ev.error_lines.append(raw_line.strip())
            if ev.first_error_ms is None:
                tm = _TS_MS_RE.search(raw_line)
                if tm:
                    ev.first_error_ms = int(tm.group(1))
        elif level == "warn":
            ev.warn_lines.append(raw_line.strip())

    tmp = _TEMP_RE.search(log_text)
    if tmp:
        ev.ambient_c = float(tmp.group(1))

    ev.top_tags = tags.most_common(8)
    ev.symptoms = [name for name, kws in _SYMPTOMS.items() if any(k in lower for k in kws)]
    # Bound the stored error/warn lists so the artifact stays small.
    ev.error_lines = ev.error_lines[:40]
    ev.warn_lines = ev.warn_lines[:40]
    return ev


RCA_SYS = (
    "You are a senior automotive software engineer performing root-cause analysis from LOG evidence only. "
    "Reason strictly from the provided log lines, extracted symptoms, timings and conditions. Do not invent "
    "commit hashes or facts not supported by the logs. "
    "Return JSON with keys: root_cause (2-3 sentences), mechanism (list of causal steps grounded in specific "
    "log lines), suspected_component (string), origin ('requirement'|'design'|'code'|'unknown'), "
    "confidence (0-1), evidence (list of short strings, each quoting or referencing a log line), "
    "recommended_next_step (one sentence for the Fix phase)."
)


def analyze(ev: LogEvidence) -> dict:
    """Produce a structured RCA from log evidence. Bedrock when available, else deterministic."""
    if llm.available():
        out = _analyze_bedrock(ev)
        if out:
            out["engine"] = "Amazon Bedrock · Claude"
            return out
    out = _analyze_offline(ev)
    out["engine"] = "offline log analyzer (no Bedrock credentials)"
    return out


def _analyze_bedrock(ev: LogEvidence) -> dict | None:
    prompt = (
        f"Log sources: {', '.join(ev.sources) or 'none'}\n"
        f"Total log lines: {ev.total_lines}\n"
        f"Ambient temperature (if logged): {ev.ambient_c}\n"
        f"Extracted symptoms: {', '.join(ev.symptoms) or 'none'}\n"
        f"Most frequent log tags: {', '.join(f'{t}×{n}' for t, n in ev.top_tags)}\n"
        f"First error at: {ev.first_error_ms} ms\n\n"
        f"ERROR/FATAL lines:\n" + "\n".join(ev.error_lines[:30]) + "\n\n"
        f"WARNING lines:\n" + "\n".join(ev.warn_lines[:30]) + "\n\n"
        f"Raw log excerpt:\n{ev.raw[:8000]}"
    )
    return llm.complete_json(RCA_SYS, prompt, max_tokens=1500)


def _analyze_offline(ev: LogEvidence) -> dict:
    """Deterministic analyzer: derive a plausible root cause from the extracted log features."""
    symptoms = set(ev.symptoms)
    suspected = _guess_component(ev)
    mechanism: list[str] = []
    evidence: list[str] = []

    # Build a causal chain from whichever symptoms are present, in a sensible order.
    if "hal_timeout" in symptoms:
        mechanism.append("A readiness/timeout deadline elapses before the subsystem is ready")
    if "boot_slow" in symptoms and ev.ambient_c is not None and ev.ambient_c < 7:
        mechanism.append(f"Cold ambient ({ev.ambient_c} C) slows startup past the deadline")
    if "audio_underrun" in symptoms:
        mechanism.append("The audio sink is starved and logs repeated underruns")
    if "bt_stall" in symptoms:
        mechanism.append("The Bluetooth/A2DP stack declares a stall")
    if "reconnect" in symptoms:
        mechanism.append("A reconnect drops the active session (e.g. Android Auto / projection)")
    if "crash" in symptoms:
        mechanism.append("A fatal exception / watchdog terminates the process")
    if "oom" in symptoms:
        mechanism.append("Memory pressure triggers the low-memory killer")
    if not mechanism:
        mechanism = ["Insufficient log evidence to derive a precise causal chain; see error lines"]

    for line in ev.error_lines[:3] + ev.warn_lines[:3]:
        evidence.append(line[:160])
    if ev.ambient_c is not None:
        evidence.append(f"ambient temperature logged at {ev.ambient_c} C")
    if ev.top_tags:
        evidence.append("dominant log tag: " + ev.top_tags[0][0])

    # Confidence scales with how much corroborating evidence we actually found.
    conf = min(0.9, 0.35 + 0.12 * len(symptoms) + (0.1 if ev.error_lines else 0) + (0.1 if ev.ambient_c is not None else 0))

    root = _summarize(symptoms, suspected, ev)
    return {
        "root_cause": root,
        "mechanism": mechanism,
        "suspected_component": suspected,
        "origin": "code" if symptoms else "unknown",
        "confidence": round(conf, 2),
        "evidence": evidence or ["no structured error lines extracted"],
        "recommended_next_step": _next_step(symptoms, suspected),
    }


def _guess_component(ev: LogEvidence) -> str:
    tags = " ".join(t for t, _ in ev.top_tags).lower() + " " + ev.raw[:2000].lower()
    if any(w in tags for w in ("a2dp", "audioflinger", "bluetooth", "media", "audio")):
        return "media-service"
    if any(w in tags for w in ("projection", "carprojection", "androidauto")):
        return "car-projection"
    if any(w in tags for w in ("nav", "map", "gnss", "gps")):
        return "navigation"
    if any(w in tags for w in ("hvac", "climate", "thermal")):
        return "hvac-control"
    return "unknown"


def _summarize(symptoms: set, suspected: str, ev: LogEvidence) -> str:
    if {"hal_timeout", "audio_underrun"} & symptoms:
        cold = f" below ~7 C ({ev.ambient_c} C logged)" if ev.ambient_c is not None and ev.ambient_c < 7 else ""
        return (f"The logs show the {suspected} starting its audio stream before the HAL is ready{cold}, "
                f"starving the sink: repeated underruns escalate to a Bluetooth stall and a reconnect that drops projection.")
    if "crash" in symptoms:
        return f"The logs show a fatal fault in {suspected}; the process terminates and the feature becomes unavailable until restart."
    if "oom" in symptoms:
        return f"The logs show memory pressure in {suspected} triggering the low-memory killer, which tears down the running session."
    if ev.error_lines:
        return (f"The dominant failure in the logs is '{ev.error_lines[0][:120]}' in {suspected}; "
                "the error pattern indicates a timing/state-handling defect rather than a hardware fault.")
    return f"Insufficient error evidence in the available logs to pinpoint a single root cause in {suspected}."


def _next_step(symptoms: set, suspected: str) -> str:
    if {"hal_timeout", "audio_underrun"} & symptoms:
        return f"Gate stream start on the HAL ready callback in {suspected} and add a cold-range regression test."
    if "crash" in symptoms:
        return f"Capture the stack/ANR trace in {suspected} and add a guard plus a regression test around the faulting path."
    return f"Collect more targeted logs around the first error in {suspected} before implementing a fix."

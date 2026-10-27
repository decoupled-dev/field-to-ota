"""Requirements agent.

Answers one question for the RCA stage: *is the reported/observed behaviour a violation of a
requirement, or is the system behaving as specified?* This confirms whether we have a genuine
defect before the pipeline spends effort amending requirements and writing a fix.

It loads the requirement documents from the media-service working copy, finds the requirement(s)
most relevant to the symptom, and judges compliance with Bedrock (Claude) — falling back to a
deterministic analyzer so the demo runs offline.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from .. import llm


@dataclass
class Requirement:
    req_id: str
    path: str
    title: str
    parent: str | None
    asil: str | None
    status: str | None
    text: str                      # full markdown
    shall_clauses: list[str] = field(default_factory=list)


@dataclass
class ComplianceVerdict:
    is_violation: bool             # True = reported behaviour violates a requirement (real defect)
    requirement_id: str | None
    verdict: str                   # "violation" | "as_specified" | "no_requirement" | "ambiguous"
    violated_clause: str | None
    rationale: str
    trace: dict                    # {requirement, parent, tests}
    confidence: float
    engine: str


_SHALL_RE = re.compile(r"[^.\n]*\bshall\b[^.\n]*\.", re.I)
_FIELD_RE = lambda name: re.compile(rf"\|\s*{name}\s*\|\s*(.+?)\s*\|", re.I)  # noqa: E731


def load_requirements(repo: Path) -> list[Requirement]:
    """Parse every REQ-*.md under the repo's docs/requirements."""
    out: list[Requirement] = []
    req_dir = repo / "docs" / "requirements"
    if not req_dir.exists():
        return out
    for md in sorted(req_dir.glob("*.md")):
        text = md.read_text(errors="replace")
        rid = _first(_FIELD_RE("ID"), text) or md.stem
        out.append(Requirement(
            req_id=rid,
            path=str(md.relative_to(repo)),
            title=_title(text) or rid,
            parent=_first(_FIELD_RE("Parent"), text),
            asil=_first(_FIELD_RE("ASIL"), text),
            status=_first(_FIELD_RE("Status"), text),
            text=text,
            shall_clauses=[c.strip() for c in _SHALL_RE.findall(text)],
        ))
    return out


def find_relevant(reqs: list[Requirement], component: str | None, symptoms: list[str], summary: str) -> list[Requirement]:
    """Rank requirements by keyword overlap with the component, symptoms and problem summary."""
    terms = set()
    if component:
        terms |= set(re.split(r"[\s/_-]+", component.lower()))
    terms |= {s.replace("_", " ") for s in symptoms}
    terms |= set(re.findall(r"[a-z]{4,}", (summary or "").lower()))
    # Domain synonyms so "media-service / audio underrun" maps onto a Bluetooth-audio requirement.
    expand = {"media": {"audio", "a2dp", "bluetooth", "stream"}, "service": set(),
              "underrun": {"audio", "stream", "latency"}, "hal": {"latency", "ready", "start"},
              "bt": {"bluetooth", "a2dp"}, "reconnect": {"projection", "audio"}}
    for t in list(terms):
        terms |= expand.get(t, set())

    scored = []
    for r in reqs:
        blob = (r.title + " " + r.text).lower()
        score = sum(1 for t in terms if t and t in blob)
        if score:
            scored.append((score, r))
    scored.sort(key=lambda x: -x[0])
    return [r for _, r in scored[:3]] or reqs[:1]


_SYS = (
    "You are a requirements compliance analyst for an automotive OEM. Given a reported/observed "
    "behaviour and the applicable requirement text, decide whether the behaviour VIOLATES a "
    "requirement (a real defect) or is AS SPECIFIED (not a defect). Quote the specific 'shall' "
    "clause that applies. Return JSON with keys: is_violation (bool), verdict "
    "('violation'|'as_specified'|'ambiguous'), requirement_id (string), violated_clause (string or null), "
    "rationale (2 sentences), confidence (0-1)."
)


def assess(repo: Path, component: str | None, symptoms: list[str], observed: str,
           conditions: list[str] | None = None) -> ComplianceVerdict:
    """Decide whether `observed` behaviour violates a requirement for `component`."""
    reqs = load_requirements(repo)
    if not reqs:
        return ComplianceVerdict(False, None, "no_requirement", None,
                                 "No requirement documents were found to compare against.",
                                 {}, 0.3, "no requirements source")
    candidates = find_relevant(reqs, component, symptoms, observed)
    if llm.available():
        v = _assess_bedrock(candidates, observed, conditions or [])
        if v:
            return v
    return _assess_offline(candidates, symptoms, observed, conditions or [])


def _assess_bedrock(candidates: list[Requirement], observed: str, conditions: list[str]) -> ComplianceVerdict | None:
    req_text = "\n\n".join(f"[{r.req_id}] {r.title}\n{r.text}" for r in candidates)
    prompt = (f"Observed/reported behaviour:\n{observed}\n"
              f"Conditions: {', '.join(conditions) or 'n/a'}\n\n"
              f"Applicable requirement(s):\n{req_text}")
    data = llm.complete_json(_SYS, prompt, max_tokens=700)
    if not data:
        return None
    rid = data.get("requirement_id") or (candidates[0].req_id if candidates else None)
    chosen = next((r for r in candidates if r.req_id == rid), candidates[0] if candidates else None)
    return ComplianceVerdict(
        is_violation=bool(data.get("is_violation")),
        requirement_id=rid,
        verdict=data.get("verdict") or ("violation" if data.get("is_violation") else "as_specified"),
        violated_clause=data.get("violated_clause"),
        rationale=str(data.get("rationale", ""))[:400],
        trace=_trace(chosen),
        confidence=float(data.get("confidence", 0.6)),
        engine=llm.engine_label(),
    )


# Timing bounds we can check numerically against the observed behaviour.
_MS_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(ms|s)\b", re.I)


def _assess_offline(candidates: list[Requirement], symptoms: list[str], observed: str, conditions: list[str]) -> ComplianceVerdict:
    """Deterministic compliance check.

    Heuristic: if the requirement states a bound ('shall ... within N') and the observed behaviour
    is a failure symptom (underrun, stall, drop, crash) in that requirement's domain, the behaviour
    violates the 'shall' — the service did not deliver what was specified.
    """
    r = candidates[0]
    failureish = {"audio_underrun", "bt_stall", "reconnect", "crash", "hal_timeout", "oom"} & set(symptoms)
    neg_words = any(w in observed.lower() for w in
                    ("stutter", "drop", "disconnect", "underrun", "stall", "freeze", "crash", "fail", "not ", "never", "late"))

    # Pick the 'shall' clause the symptom most plausibly breaks.
    clause = r.shall_clauses[0] if r.shall_clauses else None
    for c in r.shall_clauses:
        if any(k in c.lower() for k in ("within", "no later", "resume", "start", "shall not")):
            clause = c
            break

    if (failureish or neg_words) and clause:
        rationale = (f"The requirement states: “{clause.strip()}”. The reported behaviour "
                     f"({', '.join(sorted(failureish)) or 'failure symptoms in the logs'}) means the service did not "
                     f"meet that clause"
                     + (f" under the reported conditions ({', '.join(conditions)})" if conditions else "")
                     + ", so this is a genuine requirement violation, not as-specified behaviour.")
        conf = min(0.9, 0.55 + 0.1 * len(failureish) + (0.1 if conditions else 0))
        return ComplianceVerdict(True, r.req_id, "violation", clause.strip(), rationale, _trace(r), round(conf, 2),
                                 "offline requirements analyzer")
    if clause:
        return ComplianceVerdict(False, r.req_id, "as_specified", None,
                                 f"The observed behaviour does not clearly contradict “{clause.strip()}”. "
                                 "Treat as a possible enhancement rather than a defect until more evidence is gathered.",
                                 _trace(r), 0.5, "offline requirements analyzer")
    return ComplianceVerdict(False, r.req_id, "ambiguous", None,
                             f"{r.req_id} has no testable 'shall' clause to compare against; compliance is ambiguous.",
                             _trace(r), 0.4, "offline requirements analyzer")


def _trace(r: Requirement | None) -> dict:
    if not r:
        return {}
    tests = re.findall(r"TC-[A-Z0-9-]+", r.text)
    return {"requirement": r.req_id, "parent": r.parent, "asil": r.asil, "status": r.status,
            "tests": sorted(set(tests)), "path": r.path}


# -- small markdown helpers -------------------------------------------------------------------
def _first(rx: re.Pattern, text: str) -> str | None:
    m = rx.search(text)
    return m.group(1).strip() if m else None


def _title(text: str) -> str | None:
    m = re.search(r"^#\s+(.+)$", text, re.M)
    return m.group(1).strip() if m else None

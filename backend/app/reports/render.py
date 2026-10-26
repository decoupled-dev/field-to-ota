"""Printable HTML reports (Ctrl+P → PDF): evidence pack, RCA, fleet impact."""
from __future__ import annotations

from datetime import datetime

from jinja2 import Environment, FileSystemLoader, select_autoescape

from .. import fleetdata
from ..stages import STAGES
from ..store import store
from pathlib import Path

_env = Environment(loader=FileSystemLoader(Path(__file__).parent / "templates"), autoescape=select_autoescape())
_env.filters["dt"] = lambda ts: datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M") if ts else "-"

REPORTS = {
    "evidence": ("Release evidence pack", "Traceability from field report to OTA: ASPICE SUP.10 / UNECE R156 software update record."),
    "rca": ("Root-cause analysis", "Mechanism, origin, escape analysis and supporting evidence."),
    "fleet": ("Fleet impact report", "Affected cohort by version, region and ambient temperature; rollout outcome."),
}


def render(case_id: str, kind: str) -> str | None:
    case = store.get_case(case_id)
    if not case or kind not in REPORTS:
        return None
    stages = {r.stage: r for r in store.list_stages(case_id)}
    signals = [s for s in (store.get_signal(i) for i in case.signal_ids) if s]
    ctx = {"case": case, "stages": stages, "defs": STAGES, "signals": signals, "title": REPORTS[kind][0],
           "generated": datetime.now().strftime("%Y-%m-%d %H:%M"), "rollout": store.get_doc("kv", f"rollout:{case_id}") or {}}
    if kind == "fleet":
        imp = fleetdata.impact()
        ctx["impact"] = {k: v for k, v in imp.items() if k not in ("affected", "severe")}
        ctx["impact"]["affected_n"], ctx["impact"]["severe_n"] = len(imp["affected"]), len(imp["severe"])
    return _env.get_template(f"{kind}.html").render(**ctx)

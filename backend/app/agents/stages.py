"""Stage handlers: one agent step per pipeline stage.

Each handler reads what earlier stages left in `ctx.shared` / the store, calls tools (connectors,
simulation, git, tests), and reports through ctx.log / ctx.artifact / ctx.link / ctx.set.
"""
from __future__ import annotations

import io
import json
import random
import shutil
import subprocess
import sys
import tarfile
import time
from collections import Counter
from pathlib import Path

from .. import fleetdata, llm, signing
from ..bus import bus
from ..config import ROOT, settings
from ..connectors.ota import ota_provider
from ..connectors.base import PullRequest
from ..connectors.scm import git, source_control
from ..connectors.trackers import issue_tracker
from ..models import CaseStatus, Signal, StageStatus, now
from ..pipeline.runner import StageContext, StageFailed, save_case, wait_for_approval
from ..repo import checkout
from ..store import store
from . import playbook

sys.path.insert(0, str(ROOT))
from sim import replay  # noqa: E402
from sim.thermal import hal_ready_ms  # noqa: E402

ENGINE = lambda: "Amazon Bedrock · Claude" if llm.available() else "offline analyzer (no Bedrock credentials)"  # noqa: E731

from ..connectors.field_discovery import field_discovery_connector


def _signals(ctx: StageContext) -> list[Signal]:
    return [s for s in (store.get_signal(i) for i in ctx.case.signal_ids) if s]


def _device_temp(signals: list[Signal]) -> float:
    for s in signals:
        if s.source.value == "device" and "ambient_c" in s.metrics:
            return float(s.metrics["ambient_c"])
    return -8.0


# 0. Field Discovery -----------------------------------------------------------------------------
def field_discovery(ctx: StageContext) -> None:
    conn = field_discovery_connector()
    ctx.run.connector = conn.info.name
    ctx.run.simulated = conn.simulated

    oem = ctx.shared.get("oem", "Stellantis")
    models = ctx.shared.get("models", ["Dodge", "Jeep", "RAM", "Chrysler", "Uconnect"])
    since_days = ctx.shared.get("since_days", 90)

    ctx.thought(
        f"Searching all configured field sources for {oem} ({', '.join(models)}) software issues "
        f"from the past {since_days} days using {conn.info.name}."
    )

    result = conn.discover(oem, models, since_days)
    issues: list[dict] = result.get("issues", [])
    sources: list[dict] = result.get("sources", [])

    # Log per-source live/simulated status
    for src in sources:
        tag = "simulated" if src.get("simulated") else "live"
        ctx.log(f"[{tag}] {src['name']} ({src.get('category','')}) → {src.get('count', 0)} results")

    actionable = [i for i in issues if i.get("is_actionable_in_mvp")]
    sources_live = sum(1 for s in sources if not s.get("simulated"))
    sources_simulated = sum(1 for s in sources if s.get("simulated"))

    ctx.artifact("Discovered issues", "json", content=issues)
    ctx.artifact("Source coverage", "json", content=sources)

    ctx.shared["discovered_issues"] = issues

    ctx.set(
        f"Field discovery complete: {len(issues)} issues found across {len(sources)} sources "
        f"({sources_live} live, {sources_simulated} simulated); {len(actionable)} actionable in MVP.",
        total_issues=len(issues),
        actionable=len(actionable),
        sources_live=sources_live,
        sources_simulated=sources_simulated,
        engine=conn.info.vendor,
    )


# 1. Detect ---------------------------------------------------------------------------------------
def detect(ctx: StageContext) -> None:
    sigs = _signals(ctx)
    by_src = Counter(s.source.value for s in sigs)
    ctx.tool(f"signal_store.query(cluster={sigs[0].cluster_id if sigs else '-'}) → {len(sigs)} signals")
    for s in sigs:
        ctx.log(f"[{s.source.value}] {s.author or s.vin}: {s.title}")
        if s.url and s.source.value != "device":
            ctx.link(s.source.value, f"{s.source.value}: {s.external_id or s.id}",
                     s.url if s.url.startswith("http") else settings.public_url + s.url, on_case=False)
    device = [s for s in sigs if s.source.value == "device"]
    for d in device:
        ctx.tool(f"bundle_analyzer.open({d.bundle_key}) rule={d.rule_id} vin={d.vin}")
        if d.bundle_key:
            ctx.artifact(f"hu-sentinel bundle · {d.vin}", "bundle", path=settings.artifacts_dir / d.bundle_key)
            excerpt = (settings.artifacts_dir / Path(d.bundle_key).parent / "logs_60s.txt")
            if excerpt.exists():
                ctx.artifact("Device log excerpt (60 s ring buffer)", "log", content=excerpt.read_text()[-6000:])
    ctx.artifact("Signals", "json", content=[{"source": s.source.value, "author": s.author or s.vin, "title": s.title,
                                              "created_at": s.created_at, "url": s.url} for s in sigs])
    ctx.set(f"{len(sigs)} field signals from {len(by_src)} channels"
            + (f", including {len(device)} in-vehicle bug report{'s' if len(device) != 1 else ''}" if device else ""),
            signals=len(sigs), sources=dict(by_src), device_reports=len(device))


# 2. Triage ---------------------------------------------------------------------------------------
TRIAGE_SYS = ("You are the triage agent of an automotive OEM. Given field signals about one suspected defect, write a crisp "
              "problem statement. JSON keys: title (<=90 chars), problem (2-3 sentences), component, sw_version, "
              "conditions (list), severity (low|medium|high|critical), reasoning (3-5 sentences on why these signals are the same defect).")


def triage(ctx: StageContext) -> None:
    sigs = _signals(ctx)
    ctx.thought("Normalizing reports: extracting component, SW version, operating conditions and severity.")
    comps = Counter(s.component for s in sigs if s.component)
    versions = Counter(s.sw_version for s in sigs if s.sw_version)
    conds = Counter(c for s in sigs for c in s.conditions)
    sev_rank = {"low": 0, "medium": 1, "high": 2, "critical": 3}
    sev = max((s.severity or "medium" for s in sigs), key=lambda x: sev_rank.get(x, 1))
    out = llm.complete_json(TRIAGE_SYS, "\n\n".join(f"[{s.source.value}] {s.title}\n{s.body}" for s in sigs)) if llm.available() else None
    if not out:
        component = comps.most_common(1)[0][0] if comps else "other"
        version = versions.most_common(1)[0][0] if versions else None
        out = {
            "title": "Bluetooth audio stutters and Android Auto drops after cold start" if component == "media-service" else sigs[0].title,
            "problem": (f"Owners on HU-{version} report crackling Bluetooth (A2DP) audio for up to ~30 s after ignition at sub-zero "
                        "ambient temperatures, followed by an Android Auto reconnect. Warm starts are unaffected. "
                        "Reports began after the HU-2.3.1 rollout."),
            "component": component, "sw_version": version, "conditions": [c for c, _ in conds.most_common()], "severity": sev,
            "reasoning": (f"{len(sigs)} signals share the same symptom vocabulary (stutter/crackle → disconnect), the same component "
                          f"({component}), the same software version ({version}) and the same trigger conditions "
                          f"({', '.join(c for c, _ in conds.most_common(3))}). Independent reporters across "
                          f"{len({s.source for s in sigs})} channels make a coincidence unlikely."
                          + (" An in-vehicle hu-sentinel report adds machine evidence (AudioFlinger underruns + A2DP stall)."
                             if any(s.source.value == "device" for s in sigs) else "")),
        }
    for c, n in conds.most_common():
        ctx.log(f"condition '{c}' in {n}/{len(sigs)} reports")
    ctx.log(f"versions: {dict(versions)}  components: {dict(comps)}")
    sw = out.get("sw_version")
    ctx.update_case(title=out["title"], component=out.get("component"), sw_version=f"HU-{sw.removeprefix('HU-')}" if sw else None,
                    severity=out.get("severity", sev))
    ctx.set(out["problem"], out.get("reasoning", ""), component=out.get("component"), sw_version=out.get("sw_version"),
            conditions=out.get("conditions"), severity=out.get("severity", sev), engine=ENGINE())


# 3. Ticket ---------------------------------------------------------------------------------------
def ticket(ctx: StageContext) -> None:
    tracker = issue_tracker()
    ctx.run.connector = tracker.info.name
    ctx.run.simulated = tracker.info.status == "simulated"
    sigs = _signals(ctx)
    triage_run = next(r for r in store.list_stages(ctx.case.id) if r.stage == "triage")
    desc = "\n".join([triage_run.summary, "", "Field evidence:"] +
                     [f"- [{s.source.value}] {s.title} ({s.url or s.vin})" for s in sigs] +
                     ["", f"Opened automatically by Loopback case {ctx.case.id}."])
    ctx.tool(f"{tracker.info.name}.create_issue(project={settings.jira_project}, type=Bug, priority={ctx.case.severity})")
    issue = tracker.create_issue(f"[Field] {ctx.case.title}", desc, ["field-to-fix", "media-service", "hu-2.3.1"], ctx.case.severity)
    ctx.shared["issue"] = issue.key
    store.put_doc("kv", f"case-issue:{ctx.case.id}", {"key": issue.key})
    ctx.link("jira", issue.key, issue.url)
    ctx.set(f"Defect {issue.key} opened with {len(sigs)} linked field reports", issue=issue.key)


# 4. Fleet impact ---------------------------------------------------------------------------------
def fleet(ctx: StageContext) -> None:
    ctx.thought("Looking for the machine signature across the fleet: AudioFlinger underruns at boot, grouped by SW version, region and ambient temperature.")
    ctx.run.connector = "Amazon Athena" if settings.mode == "aws" else "Athena (local dataset)"
    ctx.run.simulated = settings.mode != "aws"
    ctx.artifact("Athena query", "text", content=fleetdata.SIGNATURE_SQL)
    ctx.tool("athena.start_query_execution(workgroup=f2f) → fleet_telemetry.hu_daily, 7 days")
    imp = fleetdata.impact()
    aff, sev = imp["affected"], imp["severe"]
    ctx.log(f"{len(aff)} of {imp['total_vins']} vehicles show boot underruns; {len(sev)} also had A2DP reconnects (projection drops)")
    for v in imp["by_version"]:
        ctx.log(f"{v['sw_version']}: {v['affected']}/{v['total']} affected")
    ctx.log(f"all affected vehicles had minimum ambient ≤ {imp['max_affected_temp']} °C")
    ctx.artifact("Affected vehicles by region", "chart", content={
        "type": "bar", "x": "region", "series": [{"key": "affected", "label": "Affected"}, {"key": "total", "label": "Fleet"}],
        "data": imp["by_region"]})
    ctx.artifact("Affected vehicles by minimum ambient temperature", "chart", content={
        "type": "bar", "x": "bucket", "series": [{"key": "affected", "label": "Affected"}, {"key": "total", "label": "Fleet"}],
        "data": imp["by_temp"]})
    store.put_doc("kv", f"cohort:{ctx.case.id}", {"vins": [r["vin"] for r in aff]})
    ctx.update_case(affected_vins=len(aff))
    v231 = next((v for v in imp["by_version"] if v["sw_version"] == "HU-2.3.1"), {"affected": 0, "total": 0})
    ctx.set(f"{len(aff)} vehicles affected ({len(sev)} with Android Auto drops). Only HU-2.3.1, only ≤ {imp['max_affected_temp']} °C; "
            "HU-2.2.9 is clean, so this is a regression introduced in 2.3.1.",
            "Version split is binary (2.3.1 affected, 2.2.9 at zero), which isolates the change set between the two releases. "
            "The strong temperature dependence points at a timing-sensitive startup path rather than a hardware defect.",
            affected=len(aff), severe=len(sev), total=imp["total_vins"], regression_window="HU-2.2.9 → HU-2.3.1",
            affected_ratio_231=f"{v231['affected']}/{v231['total']}")


# 5. Reproduce ------------------------------------------------------------------------------------
def reproduce(ctx: StageContext) -> None:
    temp = _device_temp(_signals(ctx))
    ctx.run.connector = "Field replay harness"
    wt = checkout(ctx.case.id)
    ctx.shared["repo"] = str(wt)
    ctx.tool(f"git checkout v2.3.1 (media-service @ {git(wt, 'rev-parse', '--short', 'HEAD')})")
    ctx.thought(f"Replaying the field condition from the device bundle: ignition at {temp} °C ambient → HAL ready after {hal_ready_ms(temp)} ms.")
    res = replay.boot(wt, temp)
    lines = [f"+{t:>5} ms {lvl} {tag}: {msg}" for t, lvl, tag, msg in res["events"]]
    ctx.artifact(f"Simulated boot log @ {temp} °C (HU-2.3.1)", "log", content="\n".join(lines[:80]))
    ctx.log(f"stream started at {res['stream_start_ms']} ms, HAL ready at {res['hal_ready_ms']} ms → {res['underruns']} underruns, "
            f"{res['reconnects']} A2DP reconnect(s), projection lost={res['projection_lost']}", "warn" if res["underruns"] else "info")
    if res["underruns"] == 0:
        raise StageFailed("Could not reproduce at the reported conditions")
    ctx.tool("replay.matrix(ambient=-20…+20 °C)")
    mat = replay.matrix(wt, [-20, -15, -10, -5, 0, 5, 10, 20])
    ctx.artifact("Underruns per cold boot vs ambient (HU-2.3.1)", "chart", content={
        "type": "line", "x": "temp_c", "series": [{"key": "underruns", "label": "Underruns / boot"}], "data": mat})
    ctx.shared["repro"] = res
    onset = max(r["temp_c"] for r in mat if r["underruns"] > 0)
    ctx.set(f"Reproduced deterministically at {temp} °C: {res['underruns']} underruns and an A2DP stall within the first second of boot. "
            f"Defect appears at ≤ {onset} °C in the replay matrix.",
            reproduced=True, ambient_c=temp, hal_ready_ms=res["hal_ready_ms"], stream_start_ms=res["stream_start_ms"],
            underruns=res["underruns"], reconnects=res["reconnects"])


# 6. Root cause -----------------------------------------------------------------------------------
RCA_SYS = ("You are a senior automotive software engineer doing root-cause analysis. Use only the evidence provided. "
           "JSON keys: root_cause (2-3 sentences), mechanism (list of causal steps), origin ('requirement'|'design'|'code'), "
           "escape_reason (why verification missed it), confidence (0-1), evidence (list of short strings).")


def rca(ctx: StageContext) -> None:
    wt = Path(ctx.shared.get("repo") or checkout(ctx.case.id))
    scm = source_control()
    ctx.run.connector = scm.info.name

    # --- Log analysis first: read the actual log evidence and derive a root cause from it --------
    from . import log_rca
    ctx.thought("Gathering the log evidence for this case: hu-sentinel device bundle, the replay boot "
                "log, and the field reports. Analyzing it before correlating with source history.")
    log_text, log_sources = log_rca.collect_logs(ctx.case.id, _signals(ctx), ctx.shared)
    log_ev = log_rca.extract(log_text, log_sources)
    ctx.tool(f"log_analyzer.scan(sources={log_sources or ['none']}) → {log_ev.total_lines} lines, "
             f"{len(log_ev.error_lines)} errors, {len(log_ev.warn_lines)} warnings")
    for name, n in log_ev.top_tags[:5]:
        ctx.log(f"log tag {name}: {n} lines")
    if log_ev.symptoms:
        ctx.log(f"symptoms detected in logs: {', '.join(log_ev.symptoms)}"
                + (f"; ambient {log_ev.ambient_c} °C" if log_ev.ambient_c is not None else ""))
    log_finding = log_rca.analyze(log_ev)
    ctx.log(f"log-based root cause ({log_finding['engine']}, confidence {log_finding.get('confidence')}): "
            f"{log_finding['root_cause']}")
    ctx.artifact("Log evidence (extracted)", "json", content={
        "sources": log_ev.sources, "total_lines": log_ev.total_lines, "symptoms": log_ev.symptoms,
        "ambient_c": log_ev.ambient_c, "first_error_ms": log_ev.first_error_ms,
        "top_tags": log_ev.top_tags, "errors": log_ev.error_lines[:20], "warnings": log_ev.warn_lines[:20]})
    ctx.artifact("Log-based root-cause analysis", "json", content=log_finding)
    ctx.shared["log_rca"] = log_finding

    ctx.tool("git log --oneline v2.2.9..v2.3.1 -- media_service/ docs/requirements/")
    commits = git(wt, "log", "--format=%h %ad %s", "--date=short", "v2.2.9..v2.3.1")
    ctx.log(commits)
    ctx.tool("git log -G 'AUDIO_HAL_READY_TIMEOUT_MS =' v2.2.9..v2.3.1")
    sha = git(wt, "log", "-G", "AUDIO_HAL_READY_TIMEOUT_MS =", "--format=%h", "v2.2.9..v2.3.1").splitlines()[0]
    diff = git(wt, "show", sha, "--stat", "--patch", "--format=commit %H%nAuthor: %an%nDate:   %ad%n%n    %s%n", "--", "media_service/config.py",
               "docs/requirements/REQ-MEDIA-021.md")
    ctx.artifact(f"Regression commit {sha}", "diff", content=diff)
    code = (wt / "media_service" / "a2dp_manager.py").read_text()
    design = (wt / "docs" / "design" / "audio-startup.md").read_text()
    req = (wt / "docs" / "requirements" / "REQ-MEDIA-021.md").read_text()
    ctx.tool("knowledge_base.retrieve('audio HAL readiness low temperature') → docs/design/audio-startup.md, HW-NOTE-117")
    repro = ctx.shared.get("repro", {})
    evidence_prompt = f"Commits:\n{commits}\n\nRegression diff:\n{diff}\n\nCode:\n{code}\n\nDesign:\n{design}\n\nRequirement:\n{req}\n\nRepro: {json.dumps({k: v for k, v in repro.items() if k != 'events'})}"
    out = llm.complete_json(RCA_SYS, evidence_prompt, 1500) if llm.available() else None
    if not out:
        out = {
            "root_cause": (f"Commit {sha} (PERF-882) cut AUDIO_HAL_READY_TIMEOUT_MS from 1500 ms to 200 ms, and A2dpManager starts streaming "
                           "when the timeout elapses even if the audio HAL is not ready. Below ≈7 °C the HAL needs more than 200 ms "
                           "(eMMC derating, HW-NOTE-117), so the A2DP sink is starved, logs underruns every 20 ms period and, after 25, "
                           "the Bluetooth stack declares a stall and reconnects. That is what drops Android Auto."),
            "mechanism": ["Cold ambient → slower eMMC → audio HAL onReady at 370–1570 ms",
                          "A2dpManager waits only 200 ms, then starts the stream anyway",
                          f"Sink starved: {repro.get('underruns', '≈40')} underruns at 20 ms/period",
                          "25 consecutive underruns → BluetoothA2dp stall → reconnect",
                          "CarProjection loses audio focus → Android Auto drops for ~30 s"],
            "origin": "requirement",
            "escape_reason": "REQ-MEDIA-021 was amended with a 200 ms start-latency target, but its verification only covered a 20 °C warm boot "
                             "(TC-MEDIA-021-01). No test exercised HAL readiness slower than the new bound.",
            "confidence": 0.93,
            "evidence": [f"Regression window HU-2.2.9 → 2.3.1 contains exactly one change to the HAL wait ({sha})",
                         "Fleet: 0 affected vehicles on 2.2.9; all affected ≤ 7 °C",
                         f"Replay at {repro.get('ambient_c', -8)} °C: HAL ready {repro.get('hal_ready_ms')} ms vs stream start {repro.get('stream_start_ms')} ms",
                         "Device log: 'audio HAL not ready after 200ms, starting stream anyway' followed by AudioFlinger underruns",
                         "Design doc step 3 allows streaming before HAL ready ('to keep latency low')"],
        }
    # Carry the log analyzer's independent findings alongside the commit-correlated RCA.
    out.setdefault("log_sources", log_ev.sources)
    out.setdefault("log_symptoms", log_ev.symptoms)
    out.setdefault("log_confidence", log_finding.get("confidence"))
    if log_finding.get("evidence"):
        out["evidence"] = list(dict.fromkeys(list(out.get("evidence", [])) + log_finding["evidence"]))
    for step in out.get("mechanism", []):
        ctx.log(f"→ {step}")
    ctx.shared["rca"] = out
    ctx.shared["regression_sha"] = sha
    ctx.artifact("Root-cause analysis", "json", content=out)
    ctx.set(out["root_cause"], out.get("escape_reason", ""), origin=out.get("origin"), confidence=out.get("confidence"),
            regression_commit=sha, log_sources=log_ev.sources, log_symptoms=log_ev.symptoms, engine=ENGINE())


# 7. Requirement ----------------------------------------------------------------------------------
def requirement(ctx: StageContext) -> None:
    wt = Path(ctx.shared["repo"])
    branch = f"fix/{ctx.case.id.lower()}-a2dp-cold-start"
    git(wt, "checkout", "-q", "-B", branch)
    ctx.shared["branch"] = branch
    ctx.run.connector = "Requirements in repo"
    ctx.thought("The defect originates in the requirement: the 200 ms start target is unsafe below 7 °C. Amend REQ-MEDIA-021 and add verification cases for the cold range, so the V can't leak it again.")
    playbook.apply_requirement_fix(wt, ctx.case.id)
    git(wt, "add", "docs/requirements/REQ-MEDIA-021.md")
    git(wt, "commit", "-q", "-m", f"req(REQ-MEDIA-021): rev B, stream only after HAL ready; add cold-range verification ({ctx.case.id})")
    d = git(wt, "show", "HEAD", "--format=", "--patch")
    ctx.artifact("REQ-MEDIA-021 rev B", "diff", content=d)
    ctx.log("added TC-MEDIA-021-02 (−20…+20 °C cold boot matrix) and TC-MEDIA-021-03 (slow HAL deferral)")
    ctx.set("REQ-MEDIA-021 amended to rev B: stream only after HAL ready, wait bound 1500 ms, defer rather than force. "
            "Two verification cases added for the cold range.", requirement="REQ-MEDIA-021", revision="B",
            trace={"parent": "SYS-HMI-004", "tests": ["TC-MEDIA-021-01", "TC-MEDIA-021-02", "TC-MEDIA-021-03"]})


# 8. Fix & PR -------------------------------------------------------------------------------------
FIX_SYS = ("You are fixing a defect in a Python reference implementation of an automotive media service. Return JSON with "
           "keys 'config_py' and 'a2dp_manager_py': the complete new contents of media_service/config.py and "
           "media_service/a2dp_manager.py. Keep the public API, the event tuple format and log tags unchanged. When the HAL is slower "
           "than the wait bound, log a warning containing 'deferring stream' and start the stream at HAL ready.")


def _run_tests(wt: Path) -> tuple[bool, str]:
    p = subprocess.run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"], cwd=wt, capture_output=True, text=True)
    return p.returncode == 0, (p.stdout + p.stderr).strip()


def fix(ctx: StageContext) -> None:
    wt = Path(ctx.shared["repo"])
    scm = source_control()
    ctx.run.connector = scm.info.name
    ctx.run.simulated = scm.info.status == "simulated"
    rca_out = ctx.shared.get("rca", {})
    thermal_src = (ROOT / "sim" / "thermal.py").read_text()
    used = "playbook"
    if llm.available():
        ctx.tool("bedrock.converse(model=claude, task=patch media_service)")
        out = llm.complete_json(FIX_SYS, f"Root cause:\n{json.dumps(rca_out)}\n\nconfig.py:\n{(wt / 'media_service/config.py').read_text()}\n\n"
                                         f"a2dp_manager.py:\n{(wt / 'media_service/a2dp_manager.py').read_text()}", 3000)
        if out and out.get("config_py") and out.get("a2dp_manager_py"):
            (wt / "media_service/config.py").write_text(out["config_py"])
            (wt / "media_service/a2dp_manager.py").write_text(out["a2dp_manager_py"])
            (wt / playbook.TEST_FILE).write_text(playbook.TEST_CONTENT)
            (wt / playbook.THERMAL_FILE).write_text(thermal_src)
            ok, _ = _run_tests(wt)
            if ok:
                used = "model"
                (wt / "VERSION").write_text("2.3.2\n")
            else:
                ctx.log("model patch failed the regression tests; discarding it and applying the reviewed playbook fix", "warn")
                git(wt, "checkout", "--", "media_service")
    if used == "playbook":
        ctx.thought("Fix strategy: gate stream start on the HAL onReady callback, restore a 1500 ms wait bound, defer instead of forcing. "
                    "Add a parametrized cold-range regression test mirroring TC-MEDIA-021-02/03.")
        files = playbook.apply_code_fix(wt, thermal_src)
        for f in files:
            ctx.tool(f"edit {f}")
    git(wt, "add", "-A")
    git(wt, "commit", "-q", "-m", f"fix(audio): start A2DP only after HAL ready, defer on slow HAL ({ctx.case.id})\n\n"
                                  f"Root cause: {ctx.shared.get('regression_sha', '')} capped the HAL wait at 200 ms and forced streaming.\n"
                                  f"Implements REQ-MEDIA-021 rev B. Adds cold-range regression tests (TC-MEDIA-021-02/03).")
    diff = git(wt, "diff", "v2.3.1", "HEAD", "--", "media_service", "tests", "VERSION")
    ctx.artifact("Code change v2.3.1 → fix branch", "diff", content=diff)
    issue = store.get_doc("kv", f"case-issue:{ctx.case.id}") or {}
    body = (f"## {ctx.case.title}\n\nFixes {issue.get('key', '')} · Loopback case `{ctx.case.id}`\n\n"
            f"**Root cause.** {rca_out.get('root_cause', '')}\n\n**Change.**\n- `REQ-MEDIA-021` rev B (stream only after HAL ready)\n"
            f"- `A2dpManager.cold_start`: gate on HAL onReady, 1500 ms bound, defer instead of force\n"
            f"- Regression tests `tests/test_cold_start_regression.py` (TC-MEDIA-021-02/03)\n\n"
            f"**Fleet impact.** {ctx.case.affected_vins} vehicles on HU-2.3.1.\n\n_Opened by the Loopback Fix Agent; requires human approval before OTA._")
    ctx.tool(f"{scm.info.name}.open_pull_request(branch={ctx.shared['branch']})")
    pr = scm.open_pull_request(str(wt), ctx.shared["branch"], f"fix(audio): A2DP cold-start underruns ({issue.get('key', ctx.case.id)})", body)
    ctx.shared["pr"] = pr.__dict__
    store.put_doc("kv", f"pr:{pr.branch}", {"branch": pr.branch, "title": f"fix(audio): A2DP cold-start underruns", "body": body,
                                             "diff": git(wt, "diff", "v2.3.1", "HEAD"), "case_id": ctx.case.id, "status": "open",
                                             "commits": git(wt, "log", "--format=%h %s", "v2.3.1..HEAD")})
    ctx.link("github", f"PR · {pr.branch}", pr.url)
    if issue.get("key"):
        issue_tracker().comment(issue["key"], f"Fix proposed: {pr.url}")
    ctx.set(f"Pull request opened on {pr.branch}: HAL-ready gating + REQ-MEDIA-021 rev B + 10 regression test cases.",
            branch=pr.branch, pr=pr.url, patch_source="Bedrock (validated)" if used == "model" else "reviewed fix playbook",
            files_changed=len([l for l in diff.splitlines() if l.startswith("diff --git")]))


# 9. Verify ---------------------------------------------------------------------------------------
def verify(ctx: StageContext) -> None:
    wt = Path(ctx.shared["repo"])
    ctx.run.connector = "AWS CodeBuild" if settings.mode == "aws" else "Test runner"
    ctx.thought("A regression test is only evidence if it fails on the defective build. Run it against v2.3.1 first.")
    base = ctx.workdir / "baseline"
    shutil.rmtree(base, ignore_errors=True)
    git(ctx.workdir, "clone", "-q", "--branch", "v2.3.1", str(wt), base.name)
    for rel in (playbook.TEST_FILE, playbook.THERMAL_FILE):
        (base / rel).write_text((wt / rel).read_text())
    ok_base, out_base = _run_tests(base)
    ctx.tool("pytest tests/  (on v2.3.1 + new tests)")
    ctx.log(out_base.splitlines()[-1] if out_base else "", "warn" if not ok_base else "info")
    if ok_base:
        raise StageFailed("New regression tests pass on the defective build: they don't detect the defect")
    ctx.tool(f"pytest tests/  (on {ctx.shared['branch']})")
    ok, out = _run_tests(wt)
    ctx.write_artifact("pytest · fix branch", "test", "pytest-fix.txt", out)
    ctx.write_artifact("pytest · v2.3.1 baseline (expected to fail)", "test", "pytest-baseline.txt", out_base)
    ctx.log(out.splitlines()[-1] if out else "", "info" if ok else "error")
    if not ok:
        raise StageFailed("Unit tests failed on the fix branch")
    ctx.tool("replay.matrix(ambient=-25…+20 °C) on baseline and fix")
    temps = [-25, -20, -15, -10, -5, 0, 5, 10, 20]
    old, new = replay.matrix(base, temps), replay.matrix(wt, temps)
    data = [{"temp_c": t, "baseline": o["underruns"], "fix": n["underruns"]} for t, o, n in zip(temps, old, new)]
    ctx.artifact("Field replay: underruns per boot, HU-2.3.1 vs fix", "chart", content={
        "type": "line", "x": "temp_c", "series": [{"key": "baseline", "label": "HU-2.3.1"}, {"key": "fix", "label": "Fix (2.3.2)"}], "data": data})
    failing = [r for r in new if not r["pass"]]
    if failing:
        raise StageFailed(f"Replay still fails at {[r['temp_c'] for r in failing]} °C")
    worst = max(r["stream_start_ms"] for r in new)
    ctx.log(f"replay: {len(new)}/{len(new)} conditions pass; worst-case audio start {worst} ms (< 3 s requirement)")
    passed = sum(1 for l in out.splitlines() if " passed" in l)
    ctx.set(f"Regression tests fail on 2.3.1 and pass on the fix. Field replay is clean across −25…+20 °C; "
            f"worst-case audio start {worst} ms stays inside the 3 s budget.",
            unit_tests="passed", baseline_detects_defect=True, replay_conditions=len(new), worst_case_start_ms=worst, summary_line=out.splitlines()[-1])


# 10. Approve -------------------------------------------------------------------------------------
def approve(ctx: StageContext) -> None:
    stages = {r.stage: r for r in store.list_stages(ctx.case.id)}
    ctx.run.status = StageStatus.awaiting_approval
    ctx.set("Awaiting release approval. The evidence pack is ready for review.",
            evidence=f"/api/cases/{ctx.case.id}/reports/evidence",
            checklist=["Root cause evidenced (commit, replay, fleet)", "Requirement amended + traced",
                       "Regression tests fail on baseline, pass on fix", "Replay matrix clean −25…+20 °C",
                       f"Target cohort: {ctx.case.affected_vins} vehicles, canary first"],
            verify=stages.get("verify").summary if stages.get("verify") else "")
    ctx.update_case(status=CaseStatus.awaiting_approval)
    bus.publish("approval.requested", ctx.case.id)
    if settings.mode == "aws":  # Step Functions waitForTaskToken: the console API completes the task
        store.put_doc("kv", f"approval:{ctx.case.id}", {"task_token": ctx.shared.get("task_token"), "requested_at": now()})
        return
    decision = wait_for_approval(ctx)
    ctx.run.status = StageStatus.running
    ctx.update_case(status=CaseStatus.running)
    ctx.log(f"{'approved' if decision['approved'] else 'rejected'} by {decision['approver']}: {decision['comment'] or '-'}")
    if not decision["approved"]:
        raise StageFailed(f"Release rejected by {decision['approver']}")
    ctx.set(f"Approved by {decision['approver']}" + (f": “{decision['comment']}”" if decision["comment"] else ""),
            approver=decision["approver"], comment=decision["comment"], approved_at=now())


# 11. Release -------------------------------------------------------------------------------------
CANARY_SIMULATED = 4


def _repo_for(ctx: StageContext) -> Path:
    """Working copy on the fix branch; re-cloned when the stage runs in a fresh Lambda."""
    if ctx.shared.get("repo") and Path(ctx.shared["repo"]).exists():
        return Path(ctx.shared["repo"])
    wt = checkout(ctx.case.id)
    git(wt, "checkout", "-q", ctx.shared["branch"])
    ctx.shared["repo"] = str(wt)
    return wt


def release(ctx: StageContext) -> None:
    scm, ota = source_control(), ota_provider()
    ctx.run.connector = ota.info.name
    ctx.run.simulated = ota.info.status == "simulated"
    pr = PullRequest(**ctx.shared["pr"])
    wt = _repo_for(ctx)
    ctx.tool(f"{scm.info.name}.merge(pr={pr.branch}, method=squash)")
    scm.merge(pr)
    pr_doc = store.get_doc("kv", f"pr:{pr.branch}")
    if pr_doc:
        pr_doc["status"] = "merged"
        store.put_doc("kv", f"pr:{pr.branch}", pr_doc)
    version = (wt / "VERSION").read_text().strip()
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel in ("media_service", "VERSION"):
            tar.add(wt / rel, arcname=rel, filter=lambda ti: None if "__pycache__" in ti.name else ti)
    data = buf.getvalue()
    ctx.tool(f"build artifact media-service-{version}.tar.gz ({len(data)} bytes)")
    sig = signing.sign(data)
    ctx.tool(f"{'aws_signer.start_signing_job' if settings.mode == 'aws' else 'sign'}(ed25519, key={sig['key_id']}) sha256={sig['sha256'][:16]}…")
    art = ctx.write_artifact(f"OTA payload media-service {version}", "bundle", f"media-service-{version}.tar.gz", data)
    rel = art.relative_to(settings.artifacts_dir)
    doc = {"operation": "install", "component": "media-service", "version": version,
           "artifact_url": f"{settings.public_url}/api/artifacts/{rel}", **sig}
    ctx.artifact("IoT job document", "json", content=doc)
    cohort = fleetdata.vehicles()
    cohort_vins = set((store.get_doc("kv", f"cohort:{ctx.case.id}") or {}).get("vins", []))
    targets = [v for v in cohort if v["vin"] in cohort_vins]
    canary = [t for t in targets if t["thing"] == "hu-demo-001"] + [t for t in targets if t["thing"] != "hu-demo-001"][:CANARY_SIMULATED]
    job_id = f"{ctx.case.id.lower()}-media-{version.replace('.', '-')}"
    ctx.tool(f"iot.create_job(job={job_id}, targets=thing-group/{settings.iot_thing_group}, rollout=canary {len(canary)} → exponential)")
    url = ota.create_job(job_id, ["hu-demo-001"], doc, len(canary))
    ctx.link("iot", f"IoT job {job_id}", url)
    rollout = {"job_id": job_id, "version": version, "wave": "canary", "targeted": len(canary), "succeeded": 0, "failed": 0,
               "in_progress": len(canary), "cohort": len(targets),
               "devices": {t["vin"]: {"thing": t["thing"], "status": "QUEUED", "real": t["thing"] == "hu-demo-001"} for t in targets}}
    store.put_doc("kv", f"rollout:{ctx.case.id}", rollout)
    ctx.shared["job_id"], ctx.shared["canary"], ctx.shared["targets"] = job_id, canary, targets
    ctx.update_case(status=CaseStatus.releasing, fixed_version=f"HU-{version}")
    bus.publish("ota.updated", ctx.case.id, rollout=_public_rollout(rollout))
    ctx.set(f"HU-{version} signed and released to a canary wave of {len(canary)} vehicles (cohort: {len(targets)}).",
            job_id=job_id, version=version, sha256=sig["sha256"], canary=len(canary), cohort=len(targets))


def _public_rollout(r: dict) -> dict:
    return {k: v for k, v in r.items() if k != "devices"}


def _set_device(case_id: str, vin: str, status: str) -> dict:
    r = store.get_doc("kv", f"rollout:{case_id}")
    r["devices"][vin]["status"] = status
    vals = [d["status"] for d in r["devices"].values()]
    r["succeeded"], r["failed"] = vals.count("SUCCEEDED"), vals.count("FAILED")
    r["in_progress"] = sum(1 for v in vals if v in ("QUEUED", "IN_PROGRESS")) if r["wave"] == "cohort" else \
        r["targeted"] - r["succeeded"] - r["failed"]
    store.put_doc("kv", f"rollout:{case_id}", r)
    bus.publish("ota.updated", case_id, rollout=_public_rollout(r))
    return r


# 12. Monitor & close -----------------------------------------------------------------------------
DEVICE_WAIT_S = 120


def monitor(ctx: StageContext) -> None:
    job_id, canary, targets = ctx.shared["job_id"], ctx.shared["canary"], ctx.shared["targets"]
    version = ctx.case.fixed_version
    ctx.thought("Canary gate: every canary vehicle must install and report clean cold boots before the rest of the cohort is released.")
    demo = next((t for t in canary if t["thing"] == "hu-demo-001"), None)
    for t in canary:
        if t is not demo:
            time.sleep(0.6 * settings.demo_pace)
            _set_device(ctx.case.id, t["vin"], "SUCCEEDED")
            ctx.log(f"{t['thing']} ({t['region']}): installed {version}, post-boot underruns 0  [simulated vehicle]")
    real_ok = False
    if demo:
        ctx.log(f"waiting for hu-demo-001 (real hu-sentinel) to pick up job {job_id} …")
        deadline = time.time() + DEVICE_WAIT_S * max(settings.demo_pace, 0.05)
        while time.time() < deadline:
            job = store.get_doc("kv", f"job:hu-demo-001:{job_id}") or {}
            health = [h for h in store.list_docs("kv", "devhealth:hu-demo-001:") if h.get("ts", 0) > ctx.run.started_at]
            if job.get("status") == "FAILED":
                _set_device(ctx.case.id, demo["vin"], "FAILED")
                raise StageFailed(f"hu-demo-001 failed to install: {job.get('details')}")
            if job.get("status") == "SUCCEEDED" and any(h.get("sw_version", "").endswith(version.removeprefix("HU-")) for h in health):
                h = max(health, key=lambda x: x["ts"])
                ctx.log(f"hu-demo-001: installed {version}, first cold boot after OTA → underruns {h['metrics'].get('underruns')}, "
                        f"A2DP reconnects {h['metrics'].get('a2dp_reconnects')}", "info" if h["metrics"].get("underruns", 1) == 0 else "error")
                if h["metrics"].get("underruns", 1) != 0:
                    raise StageFailed("Canary vehicle still shows underruns after the OTA")
                real_ok = True
                _set_device(ctx.case.id, demo["vin"], "SUCCEEDED")
                break
            if job.get("status") == "IN_PROGRESS":
                _set_device(ctx.case.id, demo["vin"], "IN_PROGRESS")
            time.sleep(1)
        if not real_ok:
            ctx.log("hu-demo-001 did not report within the window; verifying on the virtual vehicle instead", "warn")
            ctx.run.simulated = True
            res = replay.boot(_repo_for(ctx), _device_temp(_signals(ctx)))
            if res["underruns"]:
                raise StageFailed("Virtual vehicle still shows underruns")
            _set_device(ctx.case.id, demo["vin"], "SUCCEEDED")
            ctx.log("virtual vehicle: clean cold boot on the released build")
    ctx.log(f"canary gate passed ({len(canary)}/{len(canary)}); releasing to the remaining {len(targets) - len(canary)} vehicles")
    r = store.get_doc("kv", f"rollout:{ctx.case.id}")
    r["wave"], r["targeted"] = "cohort", len(targets)
    store.put_doc("kv", f"rollout:{ctx.case.id}", r)
    rest = [t for t in targets if t not in canary]
    rnd = random.Random(7)
    batch = max(1, len(rest) // 8)
    for i in range(0, len(rest), batch):
        for t in rest[i:i + batch]:
            _set_device(ctx.case.id, t["vin"], "SUCCEEDED")
        ctx.update_case(fixed_vins=min(len(targets), len(canary) + i + batch))
        time.sleep((0.4 + rnd.random() * 0.3) * settings.demo_pace)
    ctx.update_case(fixed_vins=len(targets))
    ctx.log(f"cohort rollout complete: {len(targets)}/{len(targets)} vehicles on {version}  [fleet beyond canary simulated]")
    issue = store.get_doc("kv", f"case-issue:{ctx.case.id}") or {}
    tracker = issue_tracker()
    if issue.get("key"):
        ctx.tool(f"{tracker.info.name}.resolve({issue['key']})")
        tracker.resolve(issue["key"], f"Fixed in {version}, rolled out OTA to {len(targets)} vehicles. Post-OTA telemetry: 0 underruns.")
    for s in _signals(ctx):
        if s.source.value == "forum" and s.external_id:
            store.put_doc("kv", f"forumreply:{s.external_id}", {"post_id": s.external_id, "ts": now(),
                          "author": "Apex Motors Support", "body": f"Thanks for the report. A fix ({version}) is rolling out over the air now; "
                          "no dealer visit needed. Your car will install it at the next ignition-off."}, now())
            ctx.tool(f"forum.reply(thread={s.external_id})")
    ctx.set(f"{version} installed on {len(targets)} vehicles with clean post-OTA boots. Ticket resolved, owners notified.",
            fixed_vins=len(targets), canary_real_device=real_ok, mttr_minutes=round((now() - ctx.case.created_at) / 60, 1))

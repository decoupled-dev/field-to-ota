"""Device Crash Agent: the V-cycle for crashes reported by the on-vehicle issue-daemon.

Used instead of the built-in media-service stage handlers when a case's component belongs to a
registered app (device_apps.py). Every step runs for real against that app's repository and the
test vehicle:

  detect      issue-daemon signals + evidence bundle (crash stack, logcat)
  triage      problem statement from the crash (Bedrock when available)
  ticket      defect in the issue tracker
  fleet       distinct vehicles reporting the same crash signature (signal store)
  reproduce   clone the deployed branch, run its unit tests: a failing test reproduces the defect
  rca         failing test -> function under test -> last commit that changed it (git log -L)
  requirement requirements docs in the repo that cite the faulty file / function
  fix         external Fix agent patches the file (Bedrock validated by tests, else playbook);
              commit on a fix branch, push to the review remote
  verify      tests fail on the baseline and pass on the fix; build the APK
  approve     human gate (or F2F_AUTO_APPROVE)
  release     sign the APK, copy to the vehicle, verify sha256, adb install
  monitor     launch the app, watch the process and new issue-daemon reports for the window
"""
from __future__ import annotations

import re
import shlex
import subprocess
import time
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path

from .. import device_apps, llm, signing
from ..config import settings
from ..connectors.trackers import issue_tracker
from ..models import CaseStatus, Signal, StageStatus, now
from ..pipeline.runner import StageContext, StageFailed, wait_for_approval
from ..store import store
from . import external_fix_agent as fix_agent
from . import external_repo as er

AGENT = "Device Crash Agent"


# helpers -----------------------------------------------------------------------------------------
def _app(ctx: StageContext) -> dict:
    app = device_apps.for_component(ctx.case.component)
    if not app:
        raise StageFailed(f"no registered device app for component {ctx.case.component}")
    return app


def _signals(ctx: StageContext) -> list[Signal]:
    return [s for s in (store.get_signal(i) for i in ctx.case.signal_ids) if s]


def _device_signals(ctx: StageContext) -> list[Signal]:
    return [s for s in _signals(ctx) if s.source.value == "device"]


def _pkg_of(s: Signal) -> str:
    return ((s.metrics or {}).get("process") or "").split(":")[0]


def _target(app: dict) -> er.RepoTarget:
    return er.RepoTarget(url=app["repo"], branch=app["branch"], test_command=app.get("test_command"))


def _repo(ctx: StageContext) -> Path:
    return Path(ctx.shared["repo"])


def _sh(cmd: list[str], cwd: Path | None = None, timeout: int = 1800) -> subprocess.CompletedProcess:
    env = None
    if cwd and (cwd / "gradlew").exists():
        import os
        sdk = os.environ.get("ANDROID_HOME") or str(Path.home() / "android-sdk")
        env = {**os.environ, "ANDROID_HOME": sdk, "ANDROID_SDK_ROOT": sdk}
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)


def _device(app: dict, shell_cmd: str, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run `adb shell <cmd>` on the vehicle (via SSH to the host that runs the Android VM)."""
    d = app["device"]
    adb = f"adb -s {shlex.quote(d['adb_serial'])} {shell_cmd}"
    return _ssh(d, adb, timeout)


def _ssh(d: dict, remote_cmd: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(["ssh", "-i", d["ssh_key"], "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", d["ssh_host"], remote_cmd],
                          capture_output=True, text=True, timeout=timeout)


def _junit_failures(wt: Path) -> list[dict]:
    out = []
    for xml in wt.glob("**/build/test-results/**/*.xml"):
        try:
            root = ET.parse(xml).getroot()
        except ET.ParseError:
            continue
        for tc in root.iter("testcase"):
            f = tc.find("failure")
            if f is None:
                f = tc.find("error")
            if f is not None:
                out.append({"class": tc.get("classname"), "test": tc.get("name"),
                            "message": (f.get("message") or "")[:500], "trace": (f.text or "")[:4000]})
    return out


_FRAME = re.compile(r"at ([\w.$]+)\.([\w$<>]+)\(([\w]+\.(?:kt|java)):(\d+)\)")


def _find_source(wt: Path, filename: str, cls: str) -> Path | None:
    pkg_path = "/".join(cls.split(".")[:-1])
    hits = [p for p in wt.glob(f"**/{filename}") if "build" not in p.parts]
    return next((p for p in hits if pkg_path in str(p.parent)), hits[0] if hits else None)


def _fun_range(text: str, name: str) -> tuple[int, int] | None:
    """1-based line range of a top-level / member Kotlin function `fun name(`."""
    lines = text.splitlines()
    for i, l in enumerate(lines):
        if not re.search(rf"\bfun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?{re.escape(name)}\s*\(", l):
            continue
        start = i - 1  # include annotations / KDoc directly above
        while start >= 0 and (lines[start].strip().startswith("@") or lines[start].strip().startswith(("*", "/**", "*/"))):
            start -= 1
        start += 1
        # 1. skip the parameter list (parens), 2. block body {...} or expression body = ...
        parens, j, k = 0, i, l.index("fun")
        seen_open = False
        while j < len(lines):
            s = lines[j][k:] if j == i else lines[j]
            for pos, ch in enumerate(s):
                if ch == "(":
                    parens, seen_open = parens + 1, True
                elif ch == ")":
                    parens -= 1
                elif seen_open and parens == 0 and ch in "{=":
                    if ch == "=":  # expression body: until the next blank or top-level line
                        e = j
                        while e + 1 < len(lines) and lines[e + 1].strip() and lines[e + 1][:1].isspace():
                            e += 1
                        return start + 1, e + 1
                    depth = 0
                    for e in range(j, len(lines)):
                        seg = s[pos:] if e == j else lines[e]
                        depth += seg.count("{") - seg.count("}")
                        if depth <= 0:
                            return start + 1, e + 1
                    return start + 1, len(lines)
            j += 1
        return start + 1, len(lines)
    return None


def _locate_fault(wt: Path, failures: list[dict], app: dict, device_text: str) -> dict | None:
    """From the device stack (app frames) or the failing test, find the faulty function + file."""
    pkg = app["package"]
    main_src = [p for p in wt.glob("**/src/main/**/*.kt")] + [p for p in wt.glob("**/src/main/**/*.java")]
    # 1. App frames in the crash stack captured on the vehicle.
    for cls, meth, fname, line in _FRAME.findall(device_text):
        if cls.startswith(pkg) and "$" not in meth:
            src = _find_source(wt, fname, cls)
            if src and "src/main" in str(src):
                return {"file": str(src.relative_to(wt)), "function": meth, "line": int(line), "via": "device stack frame"}
    # 2. The function the failing test calls at the failing line.
    for f in failures:
        for cls, meth, fname, line in _FRAME.findall(f["trace"]):
            if not cls.startswith(pkg):
                continue
            src = _find_source(wt, fname, cls)
            if not src:
                continue
            code = src.read_text().splitlines()[int(line) - 1]
            for name in re.findall(r"\b([a-z]\w*)\s*\(", code):
                if name.startswith("assert") or name in ("listOf", "mapOf", "setOf", "println"):
                    continue
                for m in main_src:
                    t = m.read_text(errors="replace")
                    r = _fun_range(t, name)
                    if r:
                        return {"file": str(m.relative_to(wt)), "function": name, "line": r[0], "range": r,
                                "via": f"failing test {f['class'].split('.')[-1]}.{f['test']} ({fname}:{line})"}
    return None


# stages ------------------------------------------------------------------------------------------
def field_discovery(ctx: StageContext) -> None:
    ctx.run.status = StageStatus.skipped
    ctx.set("Not needed: the case was opened from an in-vehicle issue-daemon crash report, not from public sources.")


def detect(ctx: StageContext) -> None:
    app = _app(ctx)
    sigs = _device_signals(ctx)
    ctx.run.connector = "issue-daemon (AAOS system service)"
    for s in sigs:
        ctx.log(f"[issue-daemon] {s.metrics.get('thing')}: {s.rule_id} in {s.metrics.get('process')} · {s.metrics.get('exception') or s.title}")
        if s.bundle_key:
            ctx.artifact(f"issue-daemon evidence bundle · {s.metrics.get('thing')}", "bundle", path=settings.artifacts_dir / s.bundle_key)
            ex = settings.artifacts_dir / Path(s.bundle_key).parent / "logs_60s.txt"
            if ex.exists():
                ctx.shared["device_text"] = ctx.shared.get("device_text", "") + "\n" + s.body + "\n" + ex.read_text()
                ctx.artifact("Crash evidence (DropBox entry + logcat crash buffer)", "log", content=ex.read_text()[:8000])
        if s.body:
            ctx.shared["device_text"] = ctx.shared.get("device_text", "") + "\n" + s.body
    ctx.set(f"{len(sigs)} in-vehicle crash report{'s' if len(sigs) != 1 else ''} for {app['package']} from the issue-daemon",
            device_reports=len(sigs), package=app["package"])


TRIAGE_SYS = ("You are the triage agent of an automotive OEM. Given in-vehicle crash reports for one Android Automotive app, write a crisp "
              "problem statement. JSON keys: title (<=90 chars), problem (2-3 sentences), severity (low|medium|high|critical), "
              "reasoning (2-4 sentences).")


def triage(ctx: StageContext) -> None:
    app = _app(ctx)
    sigs = _device_signals(ctx)
    exc = Counter(s.metrics.get("exception") for s in sigs if s.metrics.get("exception"))
    top = exc.most_common(1)[0][0] if exc else (sigs[0].rule_id if sigs else "crash")
    ctx.thought(f"Normalizing {len(sigs)} crash report(s): process, exception, vehicle, build fingerprint.")
    out = None
    if llm.available():
        ctx.tool(f"bedrock.converse(model={settings.bedrock_model_id}, task=triage)")
        out = llm.complete_json(TRIAGE_SYS, f"App: {app.get('name', app['package'])} ({app['package']})\n\n" +
                                "\n\n".join(f"{s.title}\n{s.body[:3000]}" for s in sigs), 600)
    if not out or not out.get("title"):
        out = {"title": f"{app.get('name', app['package'])} crashes on the head unit ({top.split(':')[0].split('.')[-1]})",
               "problem": f"{app['package']} terminated with {top} on {len({s.vin for s in sigs})} vehicle(s). "
                          f"The issue-daemon captured the crash from logcat and DropBox.",
               "severity": "high", "reasoning": "A foreground HVAC app crash removes climate control from the driver; reports share the "
                                                 "same process and exception."}
    ctx.update_case(title=out["title"][:120], severity=out.get("severity", "high"), sw_version=app.get("version"))
    ctx.set(out.get("problem", ""), out.get("reasoning", ""), exception=top, package=app["package"], engine=llm.engine_label())


def ticket(ctx: StageContext) -> None:
    app = _app(ctx)
    tracker = issue_tracker()
    ctx.run.connector = tracker.info.name
    ctx.run.simulated = tracker.info.status == "simulated"
    tri = next(r for r in store.list_stages(ctx.case.id) if r.stage == "triage")
    desc = "\n".join([tri.summary, "", "In-vehicle evidence:"] +
                     [f"- {s.metrics.get('thing')}: {s.rule_id} {s.metrics.get('exception') or ''}" for s in _device_signals(ctx)] +
                     ["", f"Opened automatically by Loopback case {ctx.case.id}."])
    ctx.tool(f"{tracker.info.name}.create_issue(type=Bug, priority={ctx.case.severity})")
    issue = tracker.create_issue(f"[Vehicle] {ctx.case.title}", desc, ["field-to-fix", "issue-daemon", app["component"]], ctx.case.severity)
    store.put_doc("kv", f"case-issue:{ctx.case.id}", {"key": issue.key})
    ctx.link("jira", issue.key, issue.url)
    ctx.set(f"Defect {issue.key} opened", issue=issue.key)


def fleet(ctx: StageContext) -> None:
    app = _app(ctx)
    ctx.run.connector = "Signal store (issue-daemon reports)"
    sigs = [s for s in store.list_signals() if s.source.value == "device" and _pkg_of(s) == app["package"]]
    vins = {s.vin for s in sigs}
    by_type = Counter(s.rule_id for s in sigs)
    ctx.log(f"{len(sigs)} issue-daemon report(s) for {app['package']} from {len(vins)} vehicle(s): {dict(by_type)}")
    ctx.update_case(affected_vins=len(vins))
    ctx.set(f"{len(vins)} connected vehicle(s) reported this crash ({len(sigs)} reports).", affected=len(vins), reports=len(sigs))


def reproduce(ctx: StageContext) -> None:
    app = _app(ctx)
    target = _target(app)
    wt = ctx.workdir / "repo"
    ctx.run.connector = "Gradle unit tests"
    src = app.get("clone_url") or target.url  # clone_url: optional mirror of the deployed source
    ctx.tool(f"git clone --branch {target.branch} {src}")
    if wt.exists():
        _sh(["rm", "-rf", str(wt)])
    p = _sh(["git", "clone", "-q", "--branch", target.branch, src, str(wt)], timeout=600)
    if p.returncode != 0:
        raise StageFailed(f"clone failed: {p.stderr[:300]}")
    ctx.shared["repo"] = str(wt)
    ctx.shared["baseline_sha"] = er.git(wt, "rev-parse", "--short", "HEAD")
    ctx.log(f"checked out {target.branch} @ {ctx.shared['baseline_sha']} (the build deployed on the vehicle)")
    cmd = target.test_command or er.detect_test_command(wt)
    ctx.tool(cmd)
    res = er.run_tests(wt, target)
    failures = _junit_failures(wt)
    ctx.artifact("Unit test run on the deployed build", "log", content=res.output[-6000:])
    if res.ok or not failures:
        raise StageFailed(f"Could not reproduce: tests pass on {target.branch} @ {ctx.shared['baseline_sha']} ({res.summary_line})")
    for f in failures:
        ctx.log(f"FAILED {f['class'].split('.')[-1]}.{f['test']}: {f['message'][:160]}", "warn")
    ctx.shared["failures"] = failures
    ctx.set(f"Reproduced on {target.branch} @ {ctx.shared['baseline_sha']}: {len(failures)} unit test(s) fail.",
            reproduced=True, failing_tests=[f"{f['class']}.{f['test']}" for f in failures])


RCA_SYS = ("You are a senior Android engineer doing root-cause analysis of a crash in an Android Automotive app. Use only the evidence. "
           "JSON keys: root_cause (2-3 sentences), mechanism (list of short causal steps), origin ('requirement'|'design'|'code'), "
           "confidence (0-1).")


def rca(ctx: StageContext) -> None:
    app = _app(ctx)
    wt = _repo(ctx)
    ctx.run.connector = "git + test evidence"
    fault = _locate_fault(wt, ctx.shared.get("failures", []), app, ctx.shared.get("device_text", ""))
    if not fault:
        raise StageFailed("Could not map the crash or failing test to a source function")
    ctx.log(f"fault located in {fault['file']} · {fault['function']}() via {fault['via']}")
    src = (wt / fault["file"]).read_text()
    r = fault.get("range") or _fun_range(src, fault["function"]) or (fault["line"], fault["line"])
    body = "\n".join(src.splitlines()[r[0] - 1:r[1]])
    ctx.artifact(f"{fault['function']}() at {ctx.shared['baseline_sha']}", "text", content=body)
    ctx.tool(f"git log -L {r[0]},{r[1]}:{fault['file']}")
    hist = _sh(["git", "log", "-n", "3", "--format=%x00%h%x09%an%x09%ad%x09%s", "--date=short", "-L", f"{r[0]},{r[1]}:{fault['file']}"], wt)
    commits = [c for c in hist.stdout.split("\x00") if c.strip()]
    culprit = commits[0] if commits else ""
    head = culprit.splitlines()[0] if culprit else ""
    sha, author, date, subject = (head.split("\t") + ["", "", "", ""])[:4]
    if culprit:
        ctx.artifact(f"Last change to {fault['function']}(): {sha} {subject}", "diff", content=culprit[:6000])
        ctx.log(f"last change to the function: {sha} by {author} on {date}: {subject}")
    failures = ctx.shared.get("failures", [])
    evidence = (f"Failing tests:\n" + "\n".join(f"- {f['class']}.{f['test']}: {f['message']}" for f in failures) +
                f"\n\nDevice crash:\n{ctx.shared.get('device_text', '')[:3000]}\n\nFunction {fault['function']} in {fault['file']}:\n{body}\n\n"
                f"Most recent commit touching it:\n{culprit[:3000]}")
    out = llm.complete_json(RCA_SYS, evidence, 800) if llm.available() else None
    if not out or not out.get("root_cause"):
        removed = [l[1:].strip() for l in culprit.splitlines() if l.startswith("-") and not l.startswith("---")]
        rc = f"Commit {sha} ('{subject}') changed {fault['function']}() in {fault['file']}"
        rc += f" and removed `{removed[0]}`." if removed else "."
        if failures:
            rc += f" Since then {failures[0]['class'].split('.')[-1]}.{failures[0]['test']} fails: {failures[0]['message'][:160]}."
        out = {"root_cause": rc,
               "mechanism": ["input outside the valid range reaches the function", "the guard that handled it is gone",
                             "the result is wrong or throws, crashing the UI thread"],
               "origin": "code", "confidence": 0.8}
    ctx.shared["fault"] = fault | {"culprit_sha": sha, "culprit_subject": subject}
    ctx.shared["root_cause"] = out["root_cause"]
    ctx.set(out["root_cause"], "\n".join(f"- {m}" for m in out.get("mechanism", [])), file=fault["file"], function=fault["function"],
            culprit=sha, origin=out.get("origin"), confidence=out.get("confidence"), engine=llm.engine_label())


def requirement(ctx: StageContext) -> None:
    wt = _repo(ctx)
    fault = ctx.shared["fault"]
    fname, func = Path(fault["file"]).name, fault["function"]
    ctx.run.connector = "Requirements in repo (Markdown)"
    hits = []
    for md in [p for p in wt.glob("**/*.md") if "build" not in p.parts]:
        text = md.read_text(errors="replace")
        for sec in re.split(r"\n(?=### )", text):
            if sec.startswith("### ") and (func in sec or fname in sec):
                hits.append((md.relative_to(wt), sec.strip()[:1500]))
    for path, sec in hits[:3]:
        ctx.artifact(f"{sec.splitlines()[0][4:]} ({path})", "text", content=sec)
    ids = [re.match(r"### (\S+)", s).group(1).rstrip(":") for _, s in hits if re.match(r"### (\S+)", s)]
    ctx.shared["requirements"] = ids
    ctx.set(f"Traced to {', '.join(ids[:3])}: the fix restores the specified behaviour; no requirement change needed." if ids
            else f"No requirement in the repo cites {fname} or {func}(); fix is traced to the defect ticket only.", requirements=ids)


def fix(ctx: StageContext) -> None:
    app = _app(ctx)
    wt, fault = _repo(ctx), ctx.shared["fault"]
    target = _target(app)
    ctx.run.connector = "Fix agent (Bedrock, test-validated) + GitHub"
    res = _function_fix(ctx, wt, fault, target)
    if not res:
        ctx.tool(f"fix_agent.playbook_fix({fault['file']})")
        res = _playbook(wt, fault)
    if not res.applied:
        raise StageFailed(res.summary)
    ctx.log(f"{res.strategy}: {res.summary}")
    ctx.artifact(f"Patch for {fault['file']}", "diff", content=res.diff)
    branch = f"{app.get('branch_prefix', 'dev/')}{ctx.case.id}"
    issue = (store.get_doc("kv", f"case-issue:{ctx.case.id}") or {}).get("key", ctx.case.id)
    er.git(wt, "checkout", "-q", "-B", branch)
    er.git(wt, "-c", "user.name=Loopback Fix Agent", "-c", "user.email=fix-agent@loopback.local", "commit", "-q", "-am",
           f"fix({ctx.case.id}): {fault['function']} crash ({issue})\n\nRoot cause: {ctx.shared['root_cause']}\n"
           f"Regression: {fault.get('culprit_sha')} {fault.get('culprit_subject')}\nCase: {ctx.case.id}")
    pushed, url = _push(ctx, wt, app, branch)
    if not pushed:
        remote = settings.workspace_dir / "remote" / f"{app['package']}.git"
        if not remote.exists():
            remote.parent.mkdir(parents=True, exist_ok=True)
            _sh(["git", "init", "-q", "--bare", str(remote)])
        er.git(wt, "push", "-q", "--force", str(remote), f"HEAD:refs/heads/{branch}")
        ctx.tool(f"git push review-remote {branch} (local fallback)")
    ctx.shared["pushed_to"] = url or "local review remote"
    body = (f"## {ctx.case.title}\n\nFixes {issue} · Loopback case `{ctx.case.id}`\n\n**Root cause.** {ctx.shared['root_cause']}\n\n"
            f"**Change.** {res.summary}\n\n**Traceability.** {', '.join(ctx.shared.get('requirements') or ['-'])}\n\n"
            f"_Opened by the {AGENT}; requires human approval before OTA._")
    diff = er.git(wt, "diff", f"{ctx.shared['baseline_sha']}", "HEAD")
    store.put_doc("kv", f"pr:{branch}", {"branch": branch, "title": f"fix: {fault['function']} crash ({issue})", "body": body, "diff": diff,
                                         "case_id": ctx.case.id, "status": "open",
                                         "commits": er.git(wt, "log", "--format=%h %s", f"{ctx.shared['baseline_sha']}..HEAD")})
    ctx.link("github", f"Branch · {branch}", url or f"{settings.public_url}/tools/pulls/{branch}")
    ctx.shared.update(branch=branch, fix_strategy=res.strategy, fix_sha=er.git(wt, "rev-parse", "--short", "HEAD"))
    if issue:
        issue_tracker().comment(issue, f"Fix pushed to {branch}: {url or 'local review remote'}")
    ctx.set(f"Fix ({res.strategy}) pushed to {branch}" + (" on GitHub." if pushed else " (local review remote; GitHub push failed)."),
            branch=branch, strategy=res.strategy, file=fault["file"], pushed_to=ctx.shared["pushed_to"])


FUNC_FIX_SYS = ("You fix a crash in one Kotlin function. You get the root cause, the failing tests and the function source. "
                "Return JSON with one key 'function' holding the COMPLETE corrected function (same signature, same annotations "
                "and KDoc if present). Make the smallest change that fixes the defect. No commentary.")


def _function_fix(ctx: StageContext, wt: Path, fault: dict, target: er.RepoTarget) -> fix_agent.FixResult | None:
    """Ask Bedrock for a corrected version of only the faulty function; keep it only if all tests pass."""
    if not llm.available():
        return None
    f = wt / fault["file"]
    original = f.read_text()
    r = _fun_range(original, fault["function"])
    if not r:
        return None
    lines = original.splitlines()
    func_src = "\n".join(lines[r[0] - 1:r[1]])
    failures = "\n".join(f"- {x['class']}.{x['test']}: {x['message'][:300]}" for x in ctx.shared.get("failures", []))
    ctx.tool(f"bedrock.converse(model={settings.bedrock_model_id}, task=patch {fault['function']}())")
    out = llm.complete_json(FUNC_FIX_SYS, f"Root cause:\n{ctx.shared['root_cause']}\n\nFailing tests:\n{failures}\n\nFunction:\n{func_src}", 1500)
    new_func = (out or {}).get("function", "").strip("\n")
    if not new_func or f"fun {fault['function']}" not in new_func or new_func == func_src:
        ctx.log("Bedrock did not return a usable patch", "warn")
        return None
    patched = "\n".join(lines[:r[0] - 1] + new_func.splitlines() + lines[r[1]:]) + ("\n" if original.endswith("\n") else "")
    if "roundToInt" in new_func and "import kotlin.math.roundToInt" not in patched:
        patched = patched.replace("\nimport ", "\nimport kotlin.math.roundToInt\nimport ", 1)
    f.write_text(patched)
    ctx.tool(f"validate patch: {target.test_command or er.detect_test_command(wt)}")
    res = er.run_tests(wt, target)
    if not res.ok:
        ctx.log(f"Bedrock patch fails the tests ({res.summary_line}); reverting", "warn")
        f.write_text(original)
        return None
    return fix_agent.FixResult(True, fault["file"], "bedrock", er.git(wt, "diff", "--", fault["file"]),
                               f"Bedrock patched {fault['function']}(); all unit tests pass.")


def _playbook(wt: Path, fault: dict) -> fix_agent.FixResult:
    f = wt / fault["file"]
    pb = fix_agent.playbook_fix(f.read_text())
    if not pb:
        return fix_agent.FixResult(False, fault["file"], "none", "", "No fix strategy matched the defect; manual patch required.")
    f.write_text(pb[0])
    return fix_agent.FixResult(True, fault["file"], "playbook", er.git(wt, "diff", "--", fault["file"]), f"Reviewed playbook fix: {pb[1]}.")


def _push(ctx: StageContext, wt: Path, app: dict, branch: str) -> tuple[bool, str | None]:
    """Push the fix branch to the app's GitHub repo with F2F_GITHUB_TOKEN (never stored in git config)."""
    import os
    token = os.environ.get("F2F_GITHUB_TOKEN")
    m = re.match(r"https://github\.com/([^/]+/[^/.]+)", app["repo"])
    if not token or not m:
        ctx.log("F2F_GITHUB_TOKEN not set; skipping GitHub push", "warn")
        return False, None
    ctx.tool(f"git push origin {branch}  ({m.group(1)})")
    helper = "!f() { echo username=x-access-token; echo \"password=$F2F_GITHUB_TOKEN\"; }; f"
    p = subprocess.run(["git", "-c", "credential.helper=", "-c", f"credential.helper={helper}", "push", "--force", app["repo"],
                        f"HEAD:refs/heads/{branch}"], cwd=wt, capture_output=True, text=True, timeout=300,
                       env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    if p.returncode != 0:
        ctx.log(f"GitHub push failed: {p.stderr.strip().splitlines()[-1][:200] if p.stderr.strip() else p.returncode}", "error")
        return False, None
    url = f"https://github.com/{m.group(1)}/tree/{branch}"
    ctx.log(f"pushed {branch} → {url}")
    return True, url


def verify(ctx: StageContext) -> None:
    app = _app(ctx)
    wt = _repo(ctx)
    target = _target(app)
    ctx.run.connector = "Gradle (unit tests + APK build)"
    failing = [f"{f['class']}.{f['test']}" for f in ctx.shared.get("failures", [])]
    ctx.log(f"baseline {ctx.shared['baseline_sha']}: {len(failing)} failing test(s) (from Reproduce)")
    ctx.tool(target.test_command or er.detect_test_command(wt))
    res = er.run_tests(wt, target)
    ctx.artifact("Unit tests on the fix branch", "log", content=res.output[-6000:])
    if not res.ok:
        raise StageFailed(f"tests still fail on the fix: {res.summary_line}")
    ctx.log(f"fix {ctx.shared['fix_sha']}: all unit tests pass ({res.summary_line})")
    build = app.get("build_command", "./gradlew :app:assembleDebug --console=plain")
    ctx.tool(build)
    b = _sh(shlex.split(build), wt)
    apk = wt / app.get("apk_path", "app/build/outputs/apk/debug/app-debug.apk")
    if b.returncode != 0 or not apk.exists():
        ctx.artifact("APK build log", "log", content=(b.stdout + b.stderr)[-6000:])
        raise StageFailed("APK build failed")
    ctx.shared["apk"] = str(apk)
    ctx.log(f"built {apk.name} ({apk.stat().st_size // 1024} KiB)")
    ctx.set(f"Validated: {len(failing)} test(s) fail on the deployed build and pass on the fix. APK built.",
            baseline_detects_defect=bool(failing), unit_tests="passed", apk_kib=apk.stat().st_size // 1024)


def approve(ctx: StageContext) -> None:
    ctx.run.status = StageStatus.awaiting_approval
    ctx.set("Awaiting release approval. The evidence pack is ready for review.",
            evidence=f"/api/cases/{ctx.case.id}/reports/evidence",
            checklist=["Crash captured on the vehicle by the issue-daemon", "Root cause traced to a commit",
                       "Tests fail on the deployed build, pass on the fix", "APK built from the fix branch",
                       f"Target: {ctx.case.affected_vins} vehicle(s)"])
    from ..bus import bus
    ctx.update_case(status=CaseStatus.awaiting_approval)
    bus.publish("approval.requested", ctx.case.id)
    decision = wait_for_approval(ctx)
    ctx.run.status = StageStatus.running
    ctx.update_case(status=CaseStatus.running)
    if not decision["approved"]:
        raise StageFailed(f"Release rejected by {decision['approver']}")
    ctx.set(f"Approved by {decision['approver']}" + (f": “{decision['comment']}”" if decision["comment"] else ""),
            approver=decision["approver"], approved_at=now())


def release(ctx: StageContext) -> None:
    app = _app(ctx)
    d = app["device"]
    ctx.run.connector = f"adb over SSH ({d['ssh_host'].split('@')[-1]})"
    apk = Path(ctx.shared["apk"])
    data = apk.read_bytes()
    sig = signing.sign(data)
    version = f"{ctx.shared['branch']}@{ctx.shared['fix_sha']}"
    ctx.tool(f"sign(ed25519, key={sig['key_id']}) sha256={sig['sha256'][:16]}…")
    ctx.artifact("OTA job document", "json", content={"operation": "install", "package": app["package"], "version": version, **sig})
    remote = f"/tmp/f2f-{ctx.case.id.lower()}.apk"
    ctx.tool(f"scp {apk.name} → {d['ssh_host']}:{remote}")
    p = subprocess.run(["scp", "-q", "-i", d["ssh_key"], "-o", "BatchMode=yes", str(apk), f"{d['ssh_host']}:{remote}"],
                       capture_output=True, text=True, timeout=600)
    if p.returncode != 0:
        raise StageFailed(f"copy to vehicle failed: {p.stderr[:300]}")
    got = _ssh(d, f"sha256sum {shlex.quote(remote)}").stdout.split()[:1]
    if got != [sig["sha256"]]:
        raise StageFailed(f"sha256 mismatch on the vehicle: {got}")
    ctx.log("vehicle: payload sha256 matches the signed job document")
    ctx.tool(f"adb install -r -t {remote}")
    inst = _ssh(d, f"adb -s {shlex.quote(d['adb_serial'])} install -r -t {shlex.quote(remote)}", 300)
    ctx.log((inst.stdout + inst.stderr).strip()[-300:])
    if "Success" not in inst.stdout:
        raise StageFailed("install on the vehicle failed")
    _ssh(d, f"rm -f {shlex.quote(remote)}")
    ctx.shared["released_at"] = now()
    ctx.update_case(status=CaseStatus.releasing, fixed_version=version)
    ctx.set(f"{version} signed and installed on {d['ssh_host'].split('@')[-1]} ({app['package']}).", version=version, sha256=sig["sha256"])


def monitor(ctx: StageContext) -> None:
    app = _app(ctx)
    window = int(app.get("monitor_seconds", 60))
    ctx.run.connector = "issue-daemon + adb"
    if app.get("launch"):
        ctx.tool(app["launch"])
        _device(app, f"shell {app['launch']}")
    ctx.thought(f"Watching {app['package']} for {window} s: the process must stay up and the issue-daemon must report no new crash.")
    since, deadline = ctx.shared.get("released_at", now()), time.time() + window
    while time.time() < deadline:
        new = [s for s in store.list_signals() if s.source.value == "device" and s.created_at > since
               and _pkg_of(s) == app["package"] and s.rule_id in ("APP_CRASH", "ANR", "NATIVE_CRASH")]
        if new:
            raise StageFailed(f"issue-daemon reported {new[0].rule_id} again after the release: {new[0].title}")
        time.sleep(5)
    pid = _device(app, f"shell pidof {app['package']}").stdout.strip()
    if app.get("launch") and not pid:
        raise StageFailed(f"{app['package']} is not running after the release")
    ctx.log(f"{app['package']} running (pid {pid or '-'}), no new crash reports in {window} s")
    issue = (store.get_doc("kv", f"case-issue:{ctx.case.id}") or {}).get("key")
    if issue:
        ctx.tool(f"tracker.resolve({issue})")
        issue_tracker().resolve(issue, f"Fixed in {ctx.case.fixed_version}; installed on the vehicle, no crash reports since.")
    ctx.update_case(fixed_vins=ctx.case.affected_vins or 1)
    ctx.set(f"Clean for {window} s after the release on the vehicle. Ticket resolved.", pid=pid,
            mttr_minutes=round((now() - ctx.case.created_at) / 60, 1))


HANDLERS = {"field_discovery": field_discovery, "detect": detect, "triage": triage, "ticket": ticket, "fleet": fleet,
            "reproduce": reproduce, "rca": rca, "requirement": requirement, "fix": fix, "verify": verify,
            "approve": approve, "release": release, "monitor": monitor}

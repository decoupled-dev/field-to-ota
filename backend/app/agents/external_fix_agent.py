"""Repo-agnostic Fix agent (V-cycle Implementation phase).

Given a target repo/branch, a root cause and the faulting source file, it produces a patched
version of that file: Bedrock (Claude) writes the fix when available and it is accepted only if
the project's tests pass; otherwise a deterministic playbook fix is applied. Mirrors the contract
of the built-in media-service fix stage, but works on any repository (e.g. the Kotlin HVAC app).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from .. import llm
from . import external_repo as er

log = logging.getLogger("f2f.fix_agent")

FIX_SYS = (
    "You are a senior engineer fixing a crash defect. You are given the root cause and the full "
    "current contents of one source file. Return JSON with a single key 'file_contents' holding the "
    "COMPLETE corrected file. Make the minimal change that fixes the crash; keep the public API, "
    "signatures and surrounding code unchanged. Do not add commentary."
)


@dataclass
class FixResult:
    applied: bool
    file_path: str
    strategy: str              # "bedrock" | "playbook" | "none"
    diff: str
    summary: str


def propose_fix(current: str, root_cause: str) -> str | None:
    """Ask Bedrock for a corrected file. Returns new contents or None when unavailable/invalid."""
    if not llm.available():
        return None
    out = llm.complete_json(FIX_SYS, f"Root cause:\n{root_cause}\n\nFile contents:\n{current}", max_tokens=4000)
    if out and isinstance(out.get("file_contents"), str) and out["file_contents"].strip():
        return out["file_contents"]
    return None


def playbook_fix(current: str) -> tuple[str, str] | None:
    """Deterministic fallbacks for known crash shapes. Returns (new_contents, note) or None.

    Shape 1 (the HVAC demo): a divide/convert that crashes on a zero/invalid divisor because its
    guard clause was removed. We restore a guard in front of the risky expression.
    """
    lines = current.splitlines()
    for i, line in enumerate(lines):
        # Restore the fan-speed guard removed to introduce the crash.
        if "positionPx / widthPx" in line and "maxFanSpeed" in current:
            # Only patch if the guard is not already present just above.
            window = "\n".join(lines[max(0, i - 3):i])
            if "widthPx <= 0f" not in window and "maxFanSpeed <= 0" not in window:
                indent = line[: len(line) - len(line.lstrip())]
                guard = f"{indent}if (maxFanSpeed <= 0 || widthPx <= 0f) return 0"
                lines.insert(i, guard)
                return "\n".join(lines) + ("\n" if current.endswith("\n") else ""), \
                    "restored missing guard: return 0 when maxFanSpeed<=0 or widthPx<=0 before the division"
    return None


def apply(wt: Path, rel_path: str, root_cause: str, target: er.RepoTarget,
          test_filter: str | None = None) -> FixResult:
    """Fix the file at rel_path in working copy wt. Validates a Bedrock patch against the tests;
    falls back to the playbook fix if the model patch fails or Bedrock is unavailable."""
    f = wt / rel_path
    original = f.read_text()

    # 1. Try a model-generated patch, accept only if it makes the tests pass.
    proposed = propose_fix(original, root_cause)
    if proposed and proposed != original:
        f.write_text(proposed)
        res = er.run_tests(wt, target, test_filter)
        if res.ok:
            return FixResult(True, rel_path, "bedrock", _diff(wt, rel_path),
                             "Bedrock-generated patch applied and validated against the test suite.")
        log.info("model patch failed tests; reverting and trying the playbook")
        f.write_text(original)

    # 2. Deterministic playbook fix.
    pb = playbook_fix(original)
    if pb:
        new, note = pb
        f.write_text(new)
        return FixResult(True, rel_path, "playbook", _diff(wt, rel_path), f"Reviewed playbook fix: {note}.")

    return FixResult(False, rel_path, "none", "", "No fix strategy matched the defect; manual patch required.")


def _diff(wt: Path, rel_path: str) -> str:
    try:
        return er.git(wt, "diff", "--", rel_path)
    except RuntimeError:
        return ""

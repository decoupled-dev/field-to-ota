"""Repo-agnostic Validation agent (V-cycle Verify phase).

Proves a fix with the project's real test suite, following the same principle as the built-in
verify stage: a regression test is only evidence if it FAILS on the defective build and PASSES on
the fix. Works on any repository via external_repo's test-runner auto-detection (Gradle, pytest,
maven, npm, cargo).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from . import external_repo as er


@dataclass
class ValidationResult:
    validated: bool
    before_ok: bool            # tests result BEFORE the fix (expected to fail = defect detected)
    after_ok: bool             # tests result AFTER the fix (expected to pass)
    detects_defect: bool       # before failed → the test genuinely catches the crash
    before: er.TestResult
    after: er.TestResult
    verdict: str


def validate(wt_buggy_runner, wt_fixed_runner, target: er.RepoTarget,
             test_filter: str | None = None) -> ValidationResult:
    """Generic two-build validation. Each *_runner is a zero-arg callable returning a TestResult,
    so the caller controls how the buggy vs fixed states are produced."""
    before = wt_buggy_runner()
    after = wt_fixed_runner()
    return _assemble(before, after)


def validate_in_place(wt: Path, target: er.RepoTarget, apply_fix, revert_fix,
                      test_filter: str | None = None) -> ValidationResult:
    """Validate within a single working copy: run tests on the current (buggy) state, apply the
    fix, run again, and report. `apply_fix` / `revert_fix` are callables mutating the tree."""
    before = er.run_tests(wt, target, test_filter)
    apply_fix()
    after = er.run_tests(wt, target, test_filter)
    return _assemble(before, after)


def _assemble(before: er.TestResult, after: er.TestResult) -> ValidationResult:
    detects = not before.ok           # tests failed on the buggy build → they detect the defect
    validated = detects and after.ok  # and pass on the fix
    if validated:
        verdict = ("Validated: the regression test fails on the defective build and passes on the fix "
                   f"({after.summary_line}).")
    elif not detects:
        verdict = ("Inconclusive: the test passed even on the defective build, so it does not detect "
                   "this crash. Strengthen the test before trusting the fix.")
    else:
        verdict = f"Fix rejected: tests still fail after the patch ({after.summary_line})."
    return ValidationResult(validated, before.ok, after.ok, detects, before, after, verdict)

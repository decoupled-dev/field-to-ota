"""Repo-agnostic helpers for the external Fix and Validation agents.

These let the V-cycle Fix / Validation agents operate on an arbitrary git repository and branch
(e.g. the Kotlin HVAC demo-app) rather than only the built-in Python media-service. The goal is
the same contract as the in-repo agents: clone a working copy, apply a patch, run the project's
real tests, and report pass/fail.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from ..config import settings


@dataclass
class TestResult:
    ok: bool
    passed: int | None
    failed: int | None
    summary_line: str
    output: str
    command: str


@dataclass
class RepoTarget:
    url: str
    branch: str
    test_command: str | None = None     # override; auto-detected when None
    env: dict = field(default_factory=dict)

    @property
    def slug(self) -> str:
        return re.sub(r"[^a-zA-Z0-9]+", "-", f"{self.url}-{self.branch}").strip("-")[:80]


def _run(cmd: list[str], cwd: Path, env: dict | None = None, timeout: int = 1800) -> subprocess.CompletedProcess:
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env=full_env, timeout=timeout)


def clone(target: RepoTarget, dest_root: Path | None = None) -> Path:
    """Clone (or refresh) a shallow working copy of target.url@branch. Returns the checkout path."""
    root = dest_root or (settings.workspace_dir / "external")
    root.mkdir(parents=True, exist_ok=True)
    wt = root / target.slug
    if wt.exists():
        shutil.rmtree(wt, ignore_errors=True)
    p = _run(["git", "clone", "--depth", "1", "--branch", target.branch, target.url, str(wt)], root, timeout=600)
    if p.returncode != 0:
        raise RuntimeError(f"clone failed: {p.stderr.strip()[:400]}")
    return wt


def detect_test_command(wt: Path) -> str:
    """Pick the project's test command from the files present."""
    if (wt / "gradlew").exists():
        return "./gradlew :app:testDebugUnitTest --console=plain"
    if (wt / "pom.xml").exists():
        return "mvn -q test"
    if (wt / "package.json").exists():
        return "npm test --silent"
    if (wt / "Cargo.toml").exists():
        return "cargo test"
    if any(wt.glob("**/test_*.py")) or (wt / "pytest.ini").exists() or (wt / "pyproject.toml").exists():
        return "pytest -q"
    return "make test"


def run_tests(wt: Path, target: RepoTarget, test_filter: str | None = None) -> TestResult:
    """Run the project's tests. Supports an optional test filter (passed through for Gradle/pytest)."""
    command = target.test_command or detect_test_command(wt)
    cmd = command.split()
    if test_filter:
        if "gradlew" in command:
            cmd += ["--tests", test_filter]
        elif "pytest" in command:
            cmd += ["-k", test_filter]
    env = dict(target.env)
    # Android projects need the SDK location even for JVM unit tests.
    if (wt / "gradlew").exists():
        sdk = os.environ.get("ANDROID_HOME") or str(Path.home() / "android-sdk")
        env.setdefault("ANDROID_HOME", sdk)
        env.setdefault("ANDROID_SDK_ROOT", sdk)
        os.chmod(wt / "gradlew", 0o755)
    try:
        p = _run(cmd, wt, env=env)
        out = (p.stdout + "\n" + p.stderr).strip()
        ok = p.returncode == 0
    except subprocess.TimeoutExpired as e:
        return TestResult(False, None, None, "test run timed out", str(e), command)
    return TestResult(ok, *_parse_counts(out), output=out, command=command)


def _parse_counts(out: str) -> tuple[int | None, int | None, str]:
    """Best-effort extraction of pass/fail counts and a summary line across frameworks."""
    last = ""
    for line in out.splitlines():
        s = line.strip()
        if s:
            last = s
    passed = failed = None
    m = re.search(r"(\d+)\s+passed", out)
    if m:
        passed = int(m.group(1))
    m = re.search(r"(\d+)\s+failed", out)
    if m:
        failed = int(m.group(1))
    # Gradle doesn't print counts by default; infer from BUILD SUCCESS/FAILED.
    if "BUILD SUCCESSFUL" in out:
        return (passed, failed if failed is not None else 0, "BUILD SUCCESSFUL")
    if "BUILD FAILED" in out:
        return (passed, failed if failed is not None else 1, next(
            (l.strip() for l in out.splitlines() if "FAILED" in l or "exception" in l.lower()), "BUILD FAILED"))
    return (passed, failed, last[:200])


def git(wt: Path, *args: str) -> str:
    p = _run(["git", *args], wt)
    if p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {p.stderr.strip()[:300]}")
    return p.stdout.strip()

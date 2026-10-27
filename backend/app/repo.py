"""The media-service source repository the agents work on.

Locally a bare repo under .state stands in for GitHub. It is created with the real release
history: 2.2.9 (HAL wait 1500 ms) and 2.3.1 (latency optimization that introduced the defect).
"""
from __future__ import annotations

import shutil
import tempfile
from pathlib import Path

from .config import settings
from .connectors.scm import git

REMOTE = settings.workspace_dir / "remote" / "media-service.git"
_ENV_ID = ["-c", "user.name=Apex HU Team", "-c", "user.email=hu-team@apexmotors.example"]


def _commit(cwd: Path, msg: str, date: str) -> None:
    git(cwd, "add", "-A")
    import os
    os.environ["GIT_AUTHOR_DATE"] = os.environ["GIT_COMMITTER_DATE"] = date
    try:
        git(cwd, *_ENV_ID, "commit", "-q", "-m", msg)
    finally:
        del os.environ["GIT_AUTHOR_DATE"], os.environ["GIT_COMMITTER_DATE"]


def ensure_remote() -> Path:
    if REMOTE.exists():
        return REMOTE
    REMOTE.parent.mkdir(parents=True, exist_ok=True)
    git(REMOTE.parent, "init", "-q", "--bare", "-b", "main", REMOTE.name)
    with tempfile.TemporaryDirectory() as tmp:
        wt = Path(tmp) / "media-service"
        shutil.copytree(settings.media_service_src, wt, ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache"))
        git(wt, "init", "-q", "-b", "main")
        # 2.2.9: conservative HAL wait
        cfg = wt / "media_service" / "config.py"
        cfg.write_text(cfg.read_text().replace("AUDIO_HAL_READY_TIMEOUT_MS = 200", "AUDIO_HAL_READY_TIMEOUT_MS = 1500"))
        req = wt / "docs" / "requirements" / "REQ-MEDIA-021.md"
        req.write_text(req.read_text().replace("The audio stream shall start no later than 200 ms after A2DP sink init.\n", "")
                       .replace("Released (HU-2.3.0)", "Released (HU-2.2.0)"))
        (wt / "VERSION").write_text("2.2.9\n")
        (wt / "media_service" / "__init__.py").write_text((wt / "media_service" / "__init__.py").read_text().replace("2.3.1", "2.2.9"))
        _commit(wt, "media-service 2.2.9", "2026-08-04T10:12:00+02:00")
        git(wt, "tag", "v2.2.9")
        # 2.3.1: the regression
        shutil.rmtree(wt / "media_service")
        shutil.copytree(settings.media_service_src / "media_service", wt / "media_service", ignore=shutil.ignore_patterns("__pycache__"))
        for f in ("VERSION", "docs/requirements/REQ-MEDIA-021.md"):
            shutil.copy(settings.media_service_src / f, wt / f)
        _commit(wt, "perf(audio): start A2DP stream after 200 ms to cut resume latency (PERF-882)\n\n"
                    "Users waited up to 1.5 s for music after ignition on slow-HAL boots. Cap the HAL\n"
                    "wait at 200 ms and start streaming; HAL catches up within a few buffer periods.\n"
                    "Updates REQ-MEDIA-021 with the 200 ms start-latency target.",
                "2026-09-22T16:40:00+02:00")
        git(wt, "tag", "v2.3.1")
        git(wt, "push", "-q", str(REMOTE), "main", "--tags")
    return REMOTE


def checkout(case_id: str) -> Path:
    """Fresh working copy for a case."""
    ensure_remote()
    wt = settings.workspace_dir / case_id / "media-service"
    if wt.exists():
        shutil.rmtree(wt)
    wt.parent.mkdir(parents=True, exist_ok=True)
    git(wt.parent, "clone", "-q", str(REMOTE), wt.name)
    git(wt, "config", "user.name", "Loopback Agent")
    git(wt, "config", "user.email", "agent@field-to-fix.example")
    return wt

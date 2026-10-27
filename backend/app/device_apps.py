"""Registry of on-vehicle apps that the issue-daemon can report crashes for.

Maps an Android package (the crashing process) to its source repo, build/test commands and the
device it is deployed on. Loaded from F2F_DEVICE_APPS_FILE (JSON), default config/device_apps.json.
"""
from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from pathlib import Path

from .config import ROOT

log = logging.getLogger("f2f.device_apps")


def _path() -> Path:
    return Path(os.environ.get("F2F_DEVICE_APPS_FILE") or ROOT / "config" / "device_apps.json")


@lru_cache(maxsize=1)
def apps() -> dict[str, dict]:
    p = _path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
    except (OSError, json.JSONDecodeError) as e:
        log.error("cannot read %s: %s", p, e)
        return {}
    return {pkg: cfg | {"package": pkg} for pkg, cfg in data.items() if not pkg.startswith("_")}


def for_process(process: str | None) -> dict | None:
    """The app config for a process name like 'com.test.design' or 'com.test.design:remote'."""
    if not process:
        return None
    return apps().get(process.split(":")[0])


def for_component(component: str | None) -> dict | None:
    if not component:
        return None
    return next((a for a in apps().values() if a.get("component") == component), None)

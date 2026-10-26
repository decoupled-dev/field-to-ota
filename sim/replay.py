"""Replay field conditions against a given media-service checkout.

Runs each boot in a subprocess so different checkouts never share imported modules.

    python sim/replay.py --service-path media-service --temps -15,-8,0,20
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sim.thermal import hal_ready_ms  # noqa: E402

_BOOT = """
import json, sys
sys.path.insert(0, sys.argv[1])
from media_service.a2dp_manager import A2dpManager
r = A2dpManager().cold_start(hal_ready_ms=int(sys.argv[2]))
print(json.dumps({"stream_start_ms": r.stream_start_ms, "underruns": r.underruns,
                  "reconnects": r.reconnects, "projection_lost": r.projection_lost, "events": r.events}))
"""


def boot(service_path: str | Path, temp_c: float) -> dict:
    hal = hal_ready_ms(temp_c)
    out = subprocess.run([sys.executable, "-I", "-c", _BOOT, str(Path(service_path).resolve()), str(hal)],
                         capture_output=True, text=True, check=True)
    res = json.loads(out.stdout)
    res.update(temp_c=temp_c, hal_ready_ms=hal)
    return res


def matrix(service_path: str | Path, temps: list[float]) -> list[dict]:
    rows = []
    for t in temps:
        r = boot(service_path, t)
        r.pop("events")
        r["pass"] = r["underruns"] == 0 and not r["projection_lost"]
        rows.append(r)
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--service-path", default="media-service")
    ap.add_argument("--temps", default="-15,-10,-5,0,5,10,20")
    a = ap.parse_args()
    print(json.dumps(matrix(a.service_path, [float(x) for x in a.temps.split(",")]), indent=2))

"""Virtual head unit: boots the installed media-service and writes logcat-style output.

hu-sentinel tails the output file exactly as it would tail `logcat -b all` on a real unit.

    python sim/headunit.py --service-path .hu/system/media-service --temp -8 --out .hu/logcat.log --interval 20
"""
from __future__ import annotations

import argparse
import json
import random
import time
from datetime import datetime
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sim.replay import boot  # noqa: E402

PID = {"A2dpManager": 1873, "AudioHAL": 612, "AudioFlinger": 598, "BluetoothA2dp": 2210, "CarProjection": 3301,
       "ActivityManager": 1012, "CarService": 1120}


def fmt(ts: float, level: str, tag: str, msg: str) -> str:
    d = datetime.fromtimestamp(ts)
    pid = PID.get(tag, 1000)
    return f"{d:%m-%d %H:%M:%S}.{int(d.microsecond / 1000):03d} {pid:5d} {pid + 37:5d} {level} {tag}: {msg}"


def run_boot(service_path: str, temp: float, out, speed: float) -> dict:
    version = (Path(service_path) / "VERSION").read_text().strip() if (Path(service_path) / "VERSION").exists() else "2.3.1"
    t0 = time.time()
    out.write(fmt(t0, "I", "CarService", f"ignition ON, ambient={temp:.1f}C, hu_sw=HU-{version}") + "\n")
    out.flush()
    res = boot(service_path, temp)
    last = 0
    for t_ms, level, tag, msg in res["events"]:
        if t_ms > 5_000:  # long-tail recovery line; don't block the demo for 30s
            t_ms = last + 400
        delay = (t_ms - last) / 1000 / speed
        if delay > 0:
            time.sleep(delay)
        last = t_ms
        out.write(fmt(time.time(), level, tag, msg) + "\n")
        out.flush()
    out.write(fmt(time.time(), "I", "ActivityManager", f"boot completed, audio underruns={res['underruns']}") + "\n")
    out.flush()
    res["sw_version"] = version
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--service-path", default="media-service")
    ap.add_argument("--temp", type=float, default=-8)
    ap.add_argument("--out", default=".hu/logcat.log")
    ap.add_argument("--interval", type=float, default=20, help="seconds between ignition cycles")
    ap.add_argument("--boots", type=int, default=0, help="0 = forever")
    ap.add_argument("--speed", type=float, default=1.0)
    a = ap.parse_args()
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(a.out, "a") as f:
        while a.boots == 0 or n < a.boots:
            r = run_boot(a.service_path, a.temp + random.uniform(-0.5, 0.5), f, a.speed)
            print(json.dumps({"boot": n, "sw": r["sw_version"], "underruns": r["underruns"], "reconnects": r["reconnects"]}))
            n += 1
            if a.boots == 0 or n < a.boots:
                time.sleep(a.interval)

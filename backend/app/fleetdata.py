"""Fleet telemetry access. Locally the dataset is a JSONL file; in aws mode the same queries run on Athena."""
from __future__ import annotations

import json
from functools import lru_cache

from .config import ROOT

FLEET_FILE = ROOT / "data" / "fleet.jsonl"

SIGNATURE_SQL = """-- Athena: fleet_telemetry.hu_daily (partitioned by dt)
SELECT region, sw_version, vin, thing_name,
       MIN(ambient_min_c)                 AS min_temp_c,
       MAX(audio_underruns_per_boot)      AS underruns_per_boot,
       SUM(a2dp_reconnects)               AS a2dp_reconnects_7d
FROM   fleet_telemetry.hu_daily
WHERE  dt >= date_add('day', -7, current_date)
  AND  component = 'media-service'
GROUP  BY region, sw_version, vin, thing_name
HAVING MAX(audio_underruns_per_boot) > 0;"""


@lru_cache(maxsize=1)
def vehicles() -> list[dict]:
    if not FLEET_FILE.exists():
        import runpy
        runpy.run_path(str(ROOT / "data" / "gen_fleet.py"), run_name="__main__")
    return [json.loads(line) for line in FLEET_FILE.read_text().splitlines() if line.strip()]


def impact() -> dict:
    rows = vehicles()
    affected = [r for r in rows if r["underruns_per_boot"] > 0]

    def group(key):
        out = {}
        for r in rows:
            g = out.setdefault(r[key], {"total": 0, "affected": 0})
            g["total"] += 1
            g["affected"] += r["underruns_per_boot"] > 0
        return out

    def bucket(t):
        lo = int((t // 5) * 5)
        return f"{lo}..{lo + 5}°C"

    temps = {}
    for r in rows:
        g = temps.setdefault(bucket(r["min_temp_c"]), {"total": 0, "affected": 0, "lo": (r["min_temp_c"] // 5) * 5})
        g["total"] += 1
        g["affected"] += r["underruns_per_boot"] > 0
    return {
        "total_vins": len(rows),
        "affected": affected,
        "severe": [r for r in affected if r["a2dp_reconnects_7d"] > 0],
        "by_region": [{"region": k, **v} for k, v in sorted(group("region").items(), key=lambda kv: -kv[1]["affected"])],
        "by_version": [{"sw_version": k, **v} for k, v in sorted(group("sw_version").items())],
        "by_temp": [{"bucket": k, "affected": v["affected"], "total": v["total"]} for k, v in sorted(temps.items(), key=lambda kv: kv[1]["lo"])],
        "max_affected_temp": max((r["min_temp_c"] for r in affected), default=None),
    }

"""Generate the synthetic fleet telemetry used by the Fleet Impact stage (stands in for S3/Athena).

Each row is one vehicle's 7-day head-unit summary. Underruns are computed with the same timing
model as the simulator, so fleet data, reproduction and verification agree.

    python data/gen_fleet.py  ->  data/fleet.jsonl
"""
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from sim.thermal import hal_ready_ms  # noqa: E402

REGIONS = {  # region: (vehicles, mean min ambient °C over 7 days, spread)
    "Nordics": (70, -11, 4), "Alps": (55, -6, 4), "Canada": (60, -9, 5), "US-Midwest": (75, -2, 5),
    "UK & Benelux": (60, 3, 3), "US-South": (70, 12, 4), "Iberia": (55, 9, 3), "India": (55, 19, 3),
}
DEMO_VIN = "WF0SXXGCDSPF4D2C1"


def underruns(sw: str, temp: float, timeout_ms: int = 200, period: int = 20) -> int:
    if sw != "HU-2.3.1":
        return 0
    hal = hal_ready_ms(temp)
    return max(0, (hal - timeout_ms + period - 1) // period) if hal > timeout_ms else 0


def main() -> None:
    rnd = random.Random(42)
    rows = []
    n = 0
    for region, (count, mean, spread) in REGIONS.items():
        for _ in range(count):
            n += 1
            vin = DEMO_VIN if n == 1 else f"WF0SXXGCDSP{n:06d}"
            sw = "HU-2.3.1" if rnd.random() < 0.62 else "HU-2.2.9"
            t = round(rnd.gauss(mean, spread), 1)
            if vin == DEMO_VIN:
                sw, t = "HU-2.3.1", -8.0
            u = underruns(sw, t)
            cold_boots = rnd.randint(4, 7) if t < 5 else rnd.randint(0, 2)
            rows.append({"vin": vin, "thing": "hu-demo-001" if vin == DEMO_VIN else f"hu-{n:06d}", "region": region,
                         "model": rnd.choice(["Apex Terra", "Apex Terra", "Apex Volta"]), "sw_version": sw,
                         "min_temp_c": t, "cold_boots_7d": cold_boots, "underruns_per_boot": u,
                         "a2dp_reconnects_7d": (u // 25) * cold_boots})
    out = Path(__file__).with_name("fleet.jsonl")
    out.write_text("\n".join(json.dumps(r) for r in rows) + "\n")
    print(f"wrote {len(rows)} vehicles to {out}")


if __name__ == "__main__":
    main()

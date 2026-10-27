"""Run the Field Discovery Agent standalone.

    python -m backend.app.discovery              # loop forever (DISCOVERY_INTERVAL seconds)
    python -m backend.app.discovery --once       # single cycle, print JSON summary, exit

Configuration is via env (see backend/app/config.py): DISCOVERY_OEM, DISCOVERY_MODELS,
DISCOVERY_APP_URL, DISCOVERY_INTERVAL, DISCOVERY_SINCE_DAYS, DISCOVERY_PROMOTE, plus JIRA_*,
TAVILY_API_KEY, F2F_REDDIT_LIVE, AWS_REGION/BEDROCK_MODEL_ID.
"""
from __future__ import annotations

import json
import logging
import sys

from .agent import run_forever, run_once

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

if __name__ == "__main__":
    if "--once" in sys.argv:
        print(json.dumps(run_once(), indent=2))
    else:
        run_forever()

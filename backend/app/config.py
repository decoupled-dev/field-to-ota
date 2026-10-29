"""Runtime settings. Everything works offline; AWS / GitHub / Jira switch on when credentials are present."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env(key: str, default: str | None = None) -> str | None:
    v = os.environ.get(key)
    return v if v not in (None, "") else default


def _inference_geo(region: str) -> str:
    """Bedrock cross-region inference profile prefix for a region (us-east-1 -> us, ap-southeast-2 -> apac)."""
    return {"us": "us", "ca": "us", "eu": "eu", "ap": "apac"}.get(region.split("-")[0], "us")


class Settings:
    mode = _env("F2F_MODE", "local")  # local | aws
    state_dir = Path(_env("F2F_STATE_DIR", str(ROOT / ".state")))
    artifacts_dir = state_dir / "artifacts"
    workspace_dir = state_dir / "workspace"
    keys_dir = Path(_env("F2F_KEYS_DIR", str(ROOT / ".keys")))
    media_service_src = ROOT / "media-service"
    public_url = _env("F2F_PUBLIC_URL", "http://127.0.0.1:8000")

    aws_region = _env("AWS_REGION", _env("AWS_DEFAULT_REGION", "ap-southeast-2"))
    # Default to Amazon Nova (available without a Marketplace subscription) through the
    # cross-region inference profile for aws_region's geography. Override with BEDROCK_MODEL_ID
    # to use Claude where the account has that model access enabled.
    bedrock_model_id = _env("BEDROCK_MODEL_ID", f"{_inference_geo(aws_region)}.amazon.nova-lite-v1:0")
    llm = _env("F2F_LLM", "auto")  # auto | bedrock | offline
    event_bus_name = _env("F2F_EVENT_BUS")  # EventBridge bus name (aws mode)
    iot_thing_group = _env("F2F_IOT_THING_GROUP", "f2f-affected-cohort")
    artifact_bucket = _env("F2F_ARTIFACT_BUCKET")

    github_token = _env("GITHUB_TOKEN")
    github_repo = _env("GITHUB_REPO")  # owner/name of the media-service repo
    jira_url = _env("JIRA_URL")  # https://your-site.atlassian.net
    jira_email = _env("JIRA_EMAIL")
    jira_token = _env("JIRA_API_TOKEN")
    jira_project = _env("JIRA_PROJECT", "HU")
    reddit_query = _env("F2F_REDDIT_QUERY", "android auto bluetooth audio stutter cold")
    reddit_live = _env("F2F_REDDIT_LIVE", "0") == "1"

    cluster_threshold_authors = int(_env("F2F_CLUSTER_THRESHOLD", "6"))
    demo_pace = float(_env("F2F_DEMO_PACE", "1.0"))  # multiplies cosmetic delays between agent steps
    auto_approve = _env("F2F_AUTO_APPROVE", "0") == "1"

    # --- Field Discovery Agent (standalone crawler that pings the app) --------------------------
    # The OEM whose complaints we filter for, and the models we care about (comma separated).
    discovery_oem = _env("DISCOVERY_OEM", "Stellantis")
    discovery_models = [m.strip() for m in (_env("DISCOVERY_MODELS", "Jeep,Dodge,RAM,Chrysler,Uconnect") or "").split(",") if m.strip()]
    # Where the agent posts detected issues. Defaults to the local app.
    discovery_app_url = _env("DISCOVERY_APP_URL", "http://127.0.0.1:8000")
    discovery_interval = int(_env("DISCOVERY_INTERVAL", "900"))   # seconds between crawl cycles
    discovery_since_days = int(_env("DISCOVERY_SINCE_DAYS", "90"))
    # When set, the agent forces a case open on the resulting cluster instead of waiting for threshold.
    discovery_promote = _env("DISCOVERY_PROMOTE", "0") == "1"
    discovery_max_per_source = int(_env("DISCOVERY_MAX_PER_SOURCE", "8"))
    # Optional web search key (shared with the Lambda handler). Live when present, simulated otherwise.
    tavily_api_key = _env("TAVILY_API_KEY")


settings = Settings()
for d in (settings.state_dir, settings.artifacts_dir, settings.workspace_dir, settings.keys_dir):
    d.mkdir(parents=True, exist_ok=True)

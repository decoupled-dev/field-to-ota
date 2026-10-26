"""Runtime settings. Everything works offline; AWS / GitHub / Jira switch on when credentials are present."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env(key: str, default: str | None = None) -> str | None:
    v = os.environ.get(key)
    return v if v not in (None, "") else default


class Settings:
    mode = _env("F2F_MODE", "local")  # local | aws
    state_dir = Path(_env("F2F_STATE_DIR", str(ROOT / ".state")))
    artifacts_dir = state_dir / "artifacts"
    workspace_dir = state_dir / "workspace"
    keys_dir = Path(_env("F2F_KEYS_DIR", str(ROOT / ".keys")))
    media_service_src = ROOT / "media-service"
    public_url = _env("F2F_PUBLIC_URL", "http://127.0.0.1:8000")

    aws_region = _env("AWS_REGION", "us-east-1")
    bedrock_model_id = _env("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-5-20250929-v1:0")
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


settings = Settings()
for d in (settings.state_dir, settings.artifacts_dir, settings.workspace_dir, settings.keys_dir):
    d.mkdir(parents=True, exist_ok=True)

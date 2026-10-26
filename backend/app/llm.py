"""LLM access through Amazon Bedrock (Converse API).

When no AWS credentials are available the console runs in *offline* mode: agents fall back to
deterministic analyzers and every StageRun produced that way is labelled in the UI.
"""
from __future__ import annotations

import json
import logging
import re
from functools import lru_cache

from .config import settings

log = logging.getLogger("f2f.llm")


@lru_cache(maxsize=1)
def _client():
    if settings.llm == "offline":
        return None
    try:
        import boto3
        session = boto3.Session(region_name=settings.aws_region)
        if session.get_credentials() is None:
            return None
        return session.client("bedrock-runtime")
    except Exception as e:
        log.info("Bedrock unavailable: %s", e)
        return None


def available() -> bool:
    return _client() is not None


def mode() -> str:
    return "bedrock" if available() else "offline"


def complete(system: str, prompt: str, max_tokens: int = 2000) -> str | None:
    client = _client()
    if client is None:
        return None
    try:
        resp = client.converse(
            modelId=settings.bedrock_model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2},
        )
        return "".join(b.get("text", "") for b in resp["output"]["message"]["content"])
    except Exception as e:
        log.warning("Bedrock converse failed, falling back to offline analyzer: %s", e)
        return None


def complete_json(system: str, prompt: str, max_tokens: int = 2000) -> dict | None:
    text = complete(system + "\nRespond with a single JSON object and nothing else.", prompt, max_tokens)
    if not text:
        return None
    m = re.search(r"\{.*\}", text, re.S)
    try:
        return json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return None

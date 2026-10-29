"""Shared Bedrock AgentCore invocation helper.

Both the Field Discovery connector and the RCA stage invoke an AgentCore harness via
``bedrock-agentcore.invoke_harness``. This centralizes the client, session-id rules and the
streaming-response parse so each caller just passes a prompt and an ARN.

Requires boto3 >= 1.43 (bedrock-agentcore client) and the caller identity must hold
``bedrock-agentcore:InvokeHarness`` for the harness ARN.
"""
from __future__ import annotations

import logging
import re
import uuid

from ..config import settings

log = logging.getLogger("f2f.agentcore")


def available(arn_env_value: str | None) -> bool:
    """True if we have an ARN and the agentcore client exists in this boto3."""
    if not arn_env_value:
        return False
    try:
        import boto3
        return hasattr(boto3.client("bedrock-agentcore", region_name=settings.aws_region), "invoke_harness")
    except Exception as e:  # noqa: BLE001
        log.info("bedrock-agentcore client unavailable: %s", e)
        return False


def _session_id(tag: str) -> str:
    base = f"f2f-{re.sub('[^a-z0-9]', '', tag.lower())}-{uuid.uuid4().hex}{uuid.uuid4().hex}"
    if len(base) < 33:                       # API requires >= 33 chars
        base = (base + uuid.uuid4().hex * 2)
    return base[:64]


def invoke(harness_arn: str, prompt: str, tag: str = "f2f") -> str:
    """Invoke the harness with a single user message; return the concatenated streamed text."""
    import boto3
    # A harness is regional; call it in the region its ARN names, which may differ from AWS_REGION.
    region = harness_arn.split(":")[3] if harness_arn.count(":") >= 5 else settings.aws_region
    client = boto3.client("bedrock-agentcore", region_name=region or settings.aws_region)
    resp = client.invoke_harness(
        harnessArn=harness_arn,
        runtimeSessionId=_session_id(tag),
        messages=[{"role": "user", "content": [{"text": prompt}]}],
    )
    text = ""
    for event in resp.get("stream", []):
        if "contentBlockDelta" in event:
            delta = event["contentBlockDelta"].get("delta", {})
            if "text" in delta:
                text += delta["text"]
    return text

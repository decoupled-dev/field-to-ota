"""Field Discovery connectors: Bedrock Agent, Lambda, or Simulated (seed data)."""
from __future__ import annotations

import json
import os
import time

from ..config import ROOT, settings
from .base import ConnectorInfo


class BedrockAgentFieldDiscovery:
    def __init__(self):
        import boto3
        self.info = ConnectorInfo(
            "field_discovery",
            "Field Discovery Agent",
            "AWS Bedrock",
            "signal_source",
            "Bedrock Agent that crawls NHTSA, forums, Reddit, app stores and social media for OEM software issues.",
            "connected",
            ["BEDROCK_AGENT_ID", "BEDROCK_AGENT_ALIAS_ID"],
        )
        self.simulated = False
        self._client = boto3.client("bedrock-agent-runtime", region_name=settings.aws_region)

    def discover(self, oem: str, models: list[str], since_days: int) -> dict:
        agent_id = os.environ["BEDROCK_AGENT_ID"]
        alias_id = os.environ.get("BEDROCK_AGENT_ALIAS_ID", "live")
        session_id = f"f2f-{oem.lower()}-{int(time.time())}"
        payload = json.dumps({"oem": oem, "models": models, "since_days": since_days})
        response = self._client.invoke_agent(
            agentId=agent_id,
            agentAliasId=alias_id,
            sessionId=session_id,
            inputText=payload,
        )
        accumulated = ""
        for event in response["completion"]:
            if "chunk" in event:
                accumulated += event["chunk"].get("bytes", b"").decode("utf-8")
        return json.loads(accumulated)


class LambdaFieldDiscovery:
    def __init__(self):
        import boto3
        self.info = ConnectorInfo(
            "field_discovery",
            "Field Discovery Agent",
            "AWS Lambda",
            "signal_source",
            "Lambda-backed field discovery that crawls complaint sources for OEM software issues.",
            "connected",
            ["FIELD_DISCOVERY_LAMBDA_ARN"],
        )
        self.simulated = False
        self._client = boto3.client("lambda", region_name=settings.aws_region)

    def discover(self, oem: str, models: list[str], since_days: int) -> dict:
        fn_arn = os.environ["FIELD_DISCOVERY_LAMBDA_ARN"]
        payload = json.dumps({"oem": oem, "models": models, "since_days": since_days})
        response = self._client.invoke(FunctionName=fn_arn, Payload=payload.encode())
        body = response["Payload"].read()
        return json.loads(body)


class SimulatedFieldDiscovery:
    def __init__(self):
        self.info = ConnectorInfo(
            "field_discovery",
            "Field Discovery Agent",
            "Simulated",
            "signal_source",
            "Simulated field discovery returning seeded Stellantis/Uconnect issues.",
            "simulated",
            [],
        )
        self.simulated = True

    def discover(self, oem: str, models: list[str], since_days: int) -> dict:
        seed_path = ROOT / "data" / "stellantis_seed_issues.json"
        with open(seed_path) as f:
            all_issues: list[dict] = json.load(f)

        # Filter by oem/models if provided
        if models:
            models_lower = {m.lower() for m in models}
            filtered = [
                issue for issue in all_issues
                if any(m.lower() in models_lower for m in issue.get("affected_models", []))
            ]
            issues = filtered if filtered else all_issues
        else:
            issues = all_issues

        return {
            "issues": issues,
            "sources": [
                {
                    "name": "seed-data",
                    "category": "simulated",
                    "simulated": True,
                    "count": len(issues),
                }
            ],
            "simulated": True,
        }


def field_discovery_connector() -> BedrockAgentFieldDiscovery | LambdaFieldDiscovery | SimulatedFieldDiscovery:
    if settings.mode == "aws" and os.environ.get("BEDROCK_AGENT_ID"):
        return BedrockAgentFieldDiscovery()
    if os.environ.get("FIELD_DISCOVERY_LAMBDA_ARN"):
        return LambdaFieldDiscovery()
    return SimulatedFieldDiscovery()

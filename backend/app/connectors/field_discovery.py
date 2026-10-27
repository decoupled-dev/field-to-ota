"""Field Discovery connectors: Bedrock Agent, Lambda, or Simulated (seed data)."""
from __future__ import annotations

import json
import os
import re
import time
import uuid

from ..config import ROOT, settings
from .base import ConnectorInfo


class AgentCoreFieldDiscovery:
    """Invokes a Bedrock AgentCore harness (invoke_harness) as the field-discovery agent.

    Configure with DISCOVERY_AGENTCORE_ARN. Needs boto3 >= 1.43 (bedrock-agentcore client) and
    the caller identity must hold bedrock-agentcore:InvokeHarness for the harness ARN.
    """

    def __init__(self):
        self.arn = os.environ["DISCOVERY_AGENTCORE_ARN"]
        self.info = ConnectorInfo(
            "field_discovery",
            "Field Discovery Agent",
            "AWS Bedrock AgentCore",
            "signal_source",
            "Bedrock AgentCore harness that discovers OEM software/ECU/HVAC field issues.",
            "connected",
            ["DISCOVERY_AGENTCORE_ARN"],
        )
        self.simulated = False

    def discover(self, oem: str, models: list[str], since_days: int) -> dict:
        from ..agents import agentcore
        prompt = (
            f"Discover software, infotainment (IVI), ECU and HVAC field issues for OEM {oem} "
            f"(models: {', '.join(models) or 'all'}) from the last {since_days} days. "
            "Return a JSON object with keys: issues (list of objects with title, source, severity, "
            "summary, affected_models), sources (list of {name, simulated}), and total."
        )
        text = agentcore.invoke(self.arn, prompt, tag=f"disc-{oem}")
        return _coerce_discovery(text, oem, models)


def _coerce_discovery(text: str, oem: str, models: list[str]) -> dict:
    """Parse a harness text response into the connector's {issues, sources, ...} contract."""
    m = re.search(r"\{.*\}", text, re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            data.setdefault("issues", [])
            data.setdefault("sources", [{"name": "bedrock-agentcore", "simulated": False,
                                         "count": len(data.get("issues", []))}])
            data.setdefault("total", len(data.get("issues", [])))
            data["simulated"] = False
            return data
        except json.JSONDecodeError:
            pass
    # Fall back to a single free-text issue so the pipeline still gets something usable.
    return {
        "issues": [{"title": f"{oem} field-discovery result", "source": "bedrock-agentcore",
                    "severity": "medium", "summary": text[:2000], "affected_models": models}],
        "sources": [{"name": "bedrock-agentcore", "simulated": False, "count": 1}],
        "total": 1, "simulated": False,
    }


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
        _MAX_BYTES = 4 * 1024 * 1024  # 4 MB guard — agent responses should never exceed this
        for event in response["completion"]:
            if "chunk" in event:
                chunk = event["chunk"].get("bytes", b"").decode("utf-8")
                if len(accumulated) + len(chunk) > _MAX_BYTES:
                    raise RuntimeError(
                        f"Bedrock Agent response exceeded {_MAX_BYTES} bytes; aborting."
                    )
                accumulated += chunk
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
        if response.get("FunctionError"):
            body = response["Payload"].read().decode("utf-8")
            raise RuntimeError(
                f"Lambda execution error ({response['FunctionError']}): {body}"
            )
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


def field_discovery_connector():
    if os.environ.get("DISCOVERY_AGENTCORE_ARN"):
        return AgentCoreFieldDiscovery()
    if settings.mode == "aws" and os.environ.get("BEDROCK_AGENT_ID"):
        return BedrockAgentFieldDiscovery()
    if os.environ.get("FIELD_DISCOVERY_LAMBDA_ARN"):
        return LambdaFieldDiscovery()
    return SimulatedFieldDiscovery()

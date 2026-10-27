"""Field Discovery Agent.

A standalone crawler that goes through public complaint sources (car-owner forums, Reddit,
NHTSA, Google public issue tracker, partner / public JIRA, social, web search), filters for a
configurable OEM, uses Bedrock (Claude) to decide whether each item is a genuine software issue,
and pings the app's ``POST /api/signals`` endpoint so the app opens a case.

Unlike the CDK Bedrock-Agent subsystem in ``infra/``, this runs in-process (or as its own
process) and needs only ``bedrock:InvokeModel`` — so it works without deploying any AWS infra.
"""
from .agent import DiscoveryAgent, run_once, run_forever  # noqa: F401
from .model import Complaint  # noqa: F401

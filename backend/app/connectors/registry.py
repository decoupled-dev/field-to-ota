"""Connector catalog shown on the Integrations page and resolved by pipeline stages."""
from __future__ import annotations

from .. import llm
from ..config import settings
from .base import ConnectorInfo
from .ota import ota_provider
from .scm import source_control
from .trackers import issue_tracker


def catalog() -> list[dict]:
    live = settings.mode == "aws"
    entries: list[tuple[ConnectorInfo, list[str]]] = [
        (ConnectorInfo("reddit", "Reddit", "Reddit", "signal_source", "Subreddit search for owner complaints (r/AndroidAuto, brand subs).",
                       "connected" if settings.reddit_live else "simulated", ["F2F_REDDIT_QUERY"]), ["detect"]),
        (ConnectorInfo("owners_forum", "Owners forum", "DriveTalk", "signal_source", "Brand owners forum crawled via AgentCore Browser.",
                       "connected"), ["detect"]),
        (ConnectorInfo("x", "X / Twitter", "X Corp", "signal_source", "Recent search on product handles and keywords.", "simulated",
                       ["X_BEARER_TOKEN"]), ["detect"]),
        (ConnectorInfo("issuetracker", "Google Issue Tracker", "Google", "signal_source", "Public AAOS components (Car, Bluetooth, Audio).",
                       "simulated"), ["detect"]),
        (ConnectorInfo("partner_jira", "Partner Jira", "Tier-1 supplier", "signal_source", "Supplier defect feeds over REST.", "simulated",
                       ["PARTNER_JIRA_URL", "PARTNER_JIRA_TOKEN"]), ["detect"]),
        (ConnectorInfo("hu_sentinel", "hu-sentinel daemon", "Field-to-Fix", "signal_source",
                       "On-vehicle log and health monitor: rule-triggered bug bundles.", "connected"), ["detect", "monitor"]),
        (issue_tracker().info, ["ticket", "monitor"]),
        (ConnectorInfo("servicenow", "ServiceNow", "ServiceNow", "issue_tracker", "Dealer case management sync.", "available",
                       ["SN_INSTANCE", "SN_TOKEN"]), []),
        (source_control().info, ["rca", "fix"]),
        (ConnectorInfo("gitlab", "GitLab", "GitLab", "source_control", "Merge requests for self-hosted OEM GitLab.", "available",
                       ["GITLAB_URL", "GITLAB_TOKEN"]), []),
        (ConnectorInfo("gerrit", "Gerrit", "Google", "source_control", "Code review for AOSP-based platform trees.", "available",
                       ["GERRIT_URL"]), []),
        (ConnectorInfo("pytest_ci", "Test runner", "Field-to-Fix", "ci", "Executes unit tests and the field-condition replay matrix.",
                       "connected"), ["verify"]),
        (ConnectorInfo("codebuild", "AWS CodeBuild", "AWS", "ci", "Managed builds for the verification matrix.",
                       "connected" if live else "available"), ["verify"]),
        (ConnectorInfo("jenkins", "Jenkins", "Jenkins", "ci", "Existing OEM pipelines.", "available", ["JENKINS_URL"]), []),
        (ConnectorInfo("repo_reqs", "Requirements in repo", "Field-to-Fix", "requirements_alm", "Markdown requirements versioned with code.",
                       "connected"), ["requirement"]),
        (ConnectorInfo("polarion", "Polarion ALM", "Siemens", "requirements_alm", "Requirement work items and trace links.", "available",
                       ["POLARION_URL", "POLARION_TOKEN"]), []),
        (ConnectorInfo("codebeamer", "codebeamer", "PTC", "requirements_alm", "ASPICE-ready requirement management.", "available"), []),
        (ConnectorInfo("athena", "Amazon Athena", "AWS", "fleet_analytics", "SQL over fleet telemetry in S3.",
                       "connected" if live else "simulated"), ["fleet"]),
        (ConnectorInfo("fleetwise", "AWS IoT FleetWise", "AWS", "fleet_analytics", "Targeted signal collection campaigns.", "available"), []),
        (ConnectorInfo("bedrock", "Amazon Bedrock", "AWS", "llm", "Claude models for the agents (Converse API).",
                       "connected" if llm.available() else "simulated",
                       ["BEDROCK_MODEL_ID", "AWS_REGION"]), ["triage", "rca", "fix"]),
        (ConnectorInfo("hil", "dSPACE / Vector HIL", "dSPACE", "sim", "Hardware-in-the-loop benches for reproduction.", "available"), []),
        (ConnectorInfo("replay_sim", "Field replay harness", "Field-to-Fix", "sim", "Replays field timing against any build.", "connected"),
         ["reproduce", "verify"]),
        (ota_provider().info, ["release"]),
        (ConnectorInfo("aws_signer", "AWS Signer", "AWS", "ota", "Code signing for OTA payloads.",
                       "connected" if live else "simulated"), ["release"]),
        (ConnectorInfo("slack", "Slack", "Salesforce", "notifier", "Stage notifications to engineering channels.", "available",
                       ["SLACK_WEBHOOK_URL"]), []),
        (ConnectorInfo("teams", "Microsoft Teams", "Microsoft", "notifier", "Stage notifications.", "available"), []),
    ]
    return [{**info.__dict__, "stages": stages} for info, stages in entries]

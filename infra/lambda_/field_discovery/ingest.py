"""Bedrock Agent action-group Lambda: field-discovery ingest function.

Deduplicates issues using fuzzy title matching, then persists survivors to
DynamoDB.  Falls back gracefully when TABLE env var is absent (offline / test).
"""
from __future__ import annotations

import json
import logging
import os
from difflib import SequenceMatcher
from typing import Any

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Deduplication (top-level, directly importable)
# ---------------------------------------------------------------------------


def deduplicate_issues(issues: list[dict]) -> tuple[list[dict], list[dict]]:
    """Group issues with similar titles and keep the one with the highest raw_count.

    Uses difflib.SequenceMatcher on the ``title`` field; two issues are
    considered duplicates when their similarity ratio exceeds 0.70.

    Args:
        issues: List of issue dicts, each expected to have at least ``title``
                and ``raw_count`` keys.

    Returns:
        A 2-tuple ``(survivors, merged_pairs)`` where:
        - ``survivors`` is the deduplicated list (one representative per cluster).
        - ``merged_pairs`` is a list of dicts describing each merge operation::

              {
                  "kept":    <title of survivor>,
                  "dropped": <title of absorbed issue>,
                  "ratio":   <similarity score float>,
              }
    """
    if not issues:
        return [], []

    # Work on a copy so callers are not surprised by mutation.
    remaining = list(issues)
    survivors: list[dict] = []
    merged_pairs: list[dict] = []

    while remaining:
        candidate = remaining.pop(0)
        cluster = [candidate]
        still_remaining: list[dict] = []

        for other in remaining:
            ratio = SequenceMatcher(
                None,
                candidate.get("title", "").lower(),
                other.get("title", "").lower(),
            ).ratio()
            if ratio > 0.70:
                cluster.append(other)
                merged_pairs.append(
                    {
                        "kept": candidate.get("title", ""),
                        "dropped": other.get("title", ""),
                        "ratio": round(ratio, 4),
                    }
                )
            else:
                still_remaining.append(other)

        remaining = still_remaining

        # Keep the cluster member with the highest raw_count.
        best = max(cluster, key=lambda i: i.get("raw_count", 0))
        survivors.append(best)

    return survivors, merged_pairs


# ---------------------------------------------------------------------------
# DynamoDB persistence
# ---------------------------------------------------------------------------


def _write_to_dynamodb(table_name: str, oem: str, issues: list[dict]) -> int:
    """Write issues to DynamoDB; returns number of items written.

    PK = ``source#<issue.source>``
    SK = ``oem#<oem>#id#<issue.id>``

    Logs a warning and returns 0 when table_name is empty (offline mode).
    """
    if not table_name:
        logger.warning("TABLE env var not set — skipping DynamoDB write (%d issues)", len(issues))
        return 0

    try:
        import boto3  # type: ignore
        from boto3.dynamodb.types import TypeSerializer  # type: ignore

        dynamodb = boto3.resource("dynamodb")
        table = dynamodb.Table(table_name)

        written = 0
        with table.batch_writer() as batch:
            for issue in issues:
                item = {
                    "pk": f"source#{issue.get('source', 'unknown')}",
                    "sk": f"oem#{oem}#id#{issue.get('id', 'unknown')}",
                    **issue,
                }
                batch.put_item(Item=item)
                written += 1

        logger.info("Wrote %d issues to DynamoDB table %s", written, table_name)
        return written

    except Exception as exc:  # noqa: BLE001
        logger.error("DynamoDB write failed: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Public ingest function
# ---------------------------------------------------------------------------


def ingest_issues(oem: str, issues_json: str) -> dict[str, Any]:
    """Parse, deduplicate, and persist issues for a given OEM.

    Args:
        oem:         OEM name string (e.g. "Stellantis").
        issues_json: JSON string containing a list of issue dicts.

    Returns:
        {
            "stored":       <int — number written to DynamoDB>,
            "deduplicated": <int — number removed as duplicates>,
            "clusters":     <list of merged-title pairs>,
        }
    """
    try:
        issues: list[dict] = json.loads(issues_json)
    except (json.JSONDecodeError, TypeError) as exc:
        return {"error": f"Invalid issues_json: {exc}", "stored": 0, "deduplicated": 0, "clusters": []}

    if not isinstance(issues, list):
        return {"error": "issues_json must be a JSON array", "stored": 0, "deduplicated": 0, "clusters": []}

    survivors, merged_pairs = deduplicate_issues(issues)
    deduplicated_count = len(issues) - len(survivors)

    table_name = os.environ.get("TABLE", "")
    stored = _write_to_dynamodb(table_name, oem, survivors)

    return {
        "stored": stored,
        "deduplicated": deduplicated_count,
        "clusters": [{"kept": p["kept"], "dropped": p["dropped"]} for p in merged_pairs],
    }


# ---------------------------------------------------------------------------
# Bedrock Agent action-group protocol
# ---------------------------------------------------------------------------


def _parse_params(parameters: list[dict]) -> dict[str, Any]:
    """Convert Bedrock Agent parameter list [{name, type, value}] to kwargs dict."""
    out: dict[str, Any] = {}
    for p in parameters or []:
        name = p.get("name", "")
        value = p.get("value", "")
        ptype = p.get("type", "string").lower()
        if ptype == "array":
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    value = [v.strip() for v in value.split(",") if v.strip()]
        out[name] = value
    return out


def lambda_handler(event: dict, context: Any) -> dict:  # noqa: ANN401
    """Bedrock Agent action-group entry point.

    Expected event shape::

        {
            "messageVersion": "1.0",
            "actionGroup":    "FieldDiscoveryIngest",
            "function":       "ingest_issues",
            "parameters":     [{"name": ..., "type": ..., "value": ...}, ...]
        }
    """
    message_version = event.get("messageVersion", "1.0")
    action_group = event.get("actionGroup", "")
    function = event.get("function", "")
    parameters = event.get("parameters", [])

    logger.info("Invoked: actionGroup=%s function=%s", action_group, function)

    try:
        kwargs = _parse_params(parameters)

        if function == "ingest_issues":
            oem = kwargs.get("oem", "Stellantis")
            issues_json = kwargs.get("issues_json", "[]")
            result = ingest_issues(oem, issues_json)
        else:
            result = {"error": f"Unknown function: {function}"}

    except Exception as exc:  # noqa: BLE001
        logger.exception("Error handling function %s", function)
        result = {"error": str(exc)}

    return {
        "messageVersion": message_version,
        "response": {
            "actionGroup": action_group,
            "function": function,
            "functionResponse": {
                "responseBody": {
                    "TEXT": {
                        "body": json.dumps(result),
                    }
                }
            },
        },
    }

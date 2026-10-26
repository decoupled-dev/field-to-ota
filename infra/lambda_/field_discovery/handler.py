"""Bedrock Agent action-group Lambda: field-discovery search functions.

Supports two functions dispatched by the Bedrock Agent runtime:
  - search_source(source_name, query, since_days)
  - search_all_sources(oem, models, since_days)

Falls back to simulated results from seed data when Tavily is unavailable or
the source requires authentication.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# Discovery source catalogue
# ---------------------------------------------------------------------------

DISCOVERY_SOURCES: list[dict] = [
    {
        "name": "nhtsa",
        "url_template": "https://api.nhtsa.dot.gov/complaints/complaintsByVehicle?make={make}&model={model}&modelYear={year}",
        "category": "nhtsa",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "nhtsa_tsb",
        "url_template": "https://api.nhtsa.dot.gov/tsbs/tsbsByVehicle?make={make}&model={model}&modelYear={year}",
        "category": "nhtsa_tsb",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "transport_canada",
        "url_template": "https://wwwapps.tc.gc.ca/Saf-Sec-Sur/7/VRDB-BDRV/search-recherche/Results.aspx?make={make}&model={model}&year={year}",
        "category": "transport_canada",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "forum_jeep",
        "url_template": "https://www.jeepgarage.org/forum/search/?q={query}",
        "category": "forum_jeep",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "forum_dodge",
        "url_template": "https://www.dodgetalk.com/forums/search/?q={query}",
        "category": "forum_dodge",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "forum_ram",
        "url_template": "https://www.ramforumz.com/search/?q={query}",
        "category": "forum_ram",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "forum_chrysler",
        "url_template": "https://www.chryslerforums.com/search/?q={query}",
        "category": "forum_chrysler",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "reddit_jeep",
        "url_template": "https://www.reddit.com/r/Jeep/search/?q={query}&restrict_sr=1",
        "category": "reddit_jeep",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "reddit_dodge",
        "url_template": "https://www.reddit.com/r/Dodge/search/?q={query}&restrict_sr=1",
        "category": "reddit_dodge",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "reddit_ram",
        "url_template": "https://www.reddit.com/r/RAM/search/?q={query}&restrict_sr=1",
        "category": "reddit_ram",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "reddit_pacifica",
        "url_template": "https://www.reddit.com/r/ChryslerPacifica/search/?q={query}&restrict_sr=1",
        "category": "reddit_pacifica",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "reddit_complaints",
        "url_template": "https://www.reddit.com/r/CarComplaints/search/?q={query}&restrict_sr=1",
        "category": "reddit_complaints",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "app_store_google",
        "url_template": "https://play.google.com/store/apps/details?id=com.stellantis.uconnect",
        "category": "app_store_google",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "app_store_apple",
        "url_template": "https://apps.apple.com/us/app/uconnect/id564079547",
        "category": "app_store_apple",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "review_carcomplaints",
        "url_template": "https://www.carcomplaints.com/search/?q={query}",
        "category": "review_carcomplaints",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "review_carproblemzoo",
        "url_template": "https://www.carproblemzoo.com/search/?q={query}",
        "category": "review_carproblemzoo",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "review_repairpal",
        "url_template": "https://repairpal.com/problems?q={query}",
        "category": "review_repairpal",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "social_twitter",
        "url_template": "https://twitter.com/search?q={query}+uconnect&src=typed_query&f=live",
        "category": "social_twitter",
        "requires_auth": True,
        "simulated_fallback": True,
    },
    {
        "name": "social_tiktok",
        "url_template": "https://www.tiktok.com/search?q={query}+uconnect",
        "category": "social_tiktok",
        "requires_auth": True,
        "simulated_fallback": True,
    },
    {
        "name": "jira_public",
        "url_template": "https://issues.apache.org/jira/issues/?jql=text+%7E+%22{query}%22",
        "category": "jira_public",
        "requires_auth": False,
        "simulated_fallback": True,
    },
    {
        "name": "cdkglobal_dms",
        "url_template": "https://www.cdkglobal.com/dealers/dms",
        "category": "cdkglobal_dms",
        "requires_auth": True,
        "simulated_fallback": True,
    },
]

# ---------------------------------------------------------------------------
# Seed data loader
# ---------------------------------------------------------------------------

_SEED_DATA_PATH_DEFAULT = str(Path(__file__).parent / "data" / "stellantis_seed_issues.json")


def _load_seed_issues() -> list[dict]:
    """Load seed issues from SEED_DATA_PATH env (defaults to bundled file)."""
    path = os.environ.get("SEED_DATA_PATH", _SEED_DATA_PATH_DEFAULT)
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        logger.warning("Seed data not found at %s; returning empty list", path)
        return []
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse seed data: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Tavily key helper
# ---------------------------------------------------------------------------


def _get_tavily_key() -> str | None:
    """Return Tavily API key from env or SSM; return None if unavailable."""
    key = os.environ.get("TAVILY_API_KEY", "").strip()
    if key:
        return key

    ssm_path = os.environ.get("TAVILY_SSM_PATH", "").strip()
    if not ssm_path:
        return None

    try:
        import boto3  # type: ignore

        client = boto3.client("ssm")
        resp = client.get_parameter(Name=ssm_path, WithDecryption=True)
        return resp["Parameter"]["Value"].strip() or None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not retrieve Tavily key from SSM (%s): %s", ssm_path, exc)
        return None


# ---------------------------------------------------------------------------
# Tavily search (live)
# ---------------------------------------------------------------------------


def _tavily_search(query: str, url: str, since_days: int) -> list[dict]:
    """Call Tavily search API; return list of result dicts."""
    try:
        import requests  # type: ignore

        api_key = _get_tavily_key()
        if not api_key:
            raise RuntimeError("No Tavily key")

        cutoff = (datetime.now(timezone.utc) - timedelta(days=since_days)).strftime("%Y-%m-%d")
        payload = {
            "api_key": api_key,
            "query": query,
            "search_depth": "advanced",
            "include_domains": [url.split("/")[2]] if url else [],
            "max_results": 10,
            "include_published_date": True,
        }
        resp = requests.post("https://api.tavily.com/search", json=payload, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        results = []
        for item in data.get("results", []):
            pub = item.get("published_date", "")
            if pub and pub < cutoff:
                continue
            results.append(
                {
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "snippet": item.get("content", "")[:400],
                    "published_date": pub,
                    "score": item.get("score", 0.0),
                }
            )
        return results
    except Exception as exc:  # noqa: BLE001
        logger.warning("Tavily search failed: %s", exc)
        return []


# ---------------------------------------------------------------------------
# Simulated search from seed data
# ---------------------------------------------------------------------------


def _simulated_search(source: dict, query: str, since_days: int) -> list[dict]:
    """Return seed issues whose tags or summary loosely match the query terms."""
    seeds = _load_seed_issues()
    query_terms = {t.lower() for t in query.replace("-", " ").split()}
    cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)

    results = []
    for issue in seeds:
        tags = {t.lower() for t in issue.get("tags", [])}
        summary_words = set(issue.get("summary", "").lower().split())
        title_words = set(issue.get("title", "").lower().split())
        overlap = query_terms & (tags | summary_words | title_words)
        if not overlap and query_terms:
            continue
        results.append(
            {
                "title": issue["title"],
                "url": issue.get("url", ""),
                "snippet": issue.get("summary", ""),
                "source_id": issue["id"],
                "severity": issue.get("severity", "medium"),
                "frequency_score": issue.get("frequency_score", 0.0),
                "raw_count": issue.get("raw_count", 0),
                "is_actionable_in_mvp": issue.get("is_actionable_in_mvp", False),
                "tags": issue.get("tags", []),
                "simulated": True,
                "note": "SIMULATED — connector not configured",
            }
        )
    return results


# ---------------------------------------------------------------------------
# Public API functions
# ---------------------------------------------------------------------------


def search_source(source_name: str, query: str, since_days: int = 90) -> dict[str, Any]:
    """Search a single discovery source by name.

    Returns:
        {source_name, category, results, simulated, count}
    """
    source = next((s for s in DISCOVERY_SOURCES if s["name"] == source_name), None)
    if source is None:
        return {
            "source_name": source_name,
            "category": "unknown",
            "results": [],
            "simulated": False,
            "count": 0,
            "error": f"Source '{source_name}' not found in DISCOVERY_SOURCES",
        }

    tavily_key = _get_tavily_key()
    use_live = tavily_key and not source.get("requires_auth", False)

    if use_live:
        results = _tavily_search(query, source["url_template"], since_days)
        simulated = len(results) == 0  # fell through to empty
        if not results:
            results = _simulated_search(source, query, since_days)
            simulated = True
    else:
        results = _simulated_search(source, query, since_days)
        simulated = True

    return {
        "source_name": source_name,
        "category": source["category"],
        "results": results,
        "simulated": simulated,
        "count": len(results),
    }


def search_all_sources(oem: str, models: list[str], since_days: int = 90) -> dict[str, Any]:
    """Search all discovery sources for the given OEM and vehicle models.

    Returns:
        {issues: [...merged list...], sources: [{name, category, simulated, count}], total: int}
    """
    query = f"{oem} {' '.join(models)} software infotainment uconnect bug complaint".strip()
    all_issues: list[dict] = []
    source_summary: list[dict] = []

    for source in DISCOVERY_SOURCES:
        result = search_source(source["name"], query, since_days)
        for item in result["results"]:
            item["_source_name"] = source["name"]
            item["_category"] = source["category"]
        all_issues.extend(result["results"])
        source_summary.append(
            {
                "name": source["name"],
                "category": source["category"],
                "simulated": result["simulated"],
                "count": result["count"],
            }
        )

    return {
        "issues": all_issues,
        "sources": source_summary,
        "total": len(all_issues),
        "oem": oem,
        "models": models,
        "since_days": since_days,
        "queried_at": datetime.now(timezone.utc).isoformat(),
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
        if ptype in ("integer", "int"):
            try:
                value = int(value)
            except (ValueError, TypeError):
                pass
        elif ptype in ("number", "float"):
            try:
                value = float(value)
            except (ValueError, TypeError):
                pass
        elif ptype == "array":
            if isinstance(value, str):
                try:
                    value = json.loads(value)
                except json.JSONDecodeError:
                    value = [v.strip() for v in value.split(",") if v.strip()]
        elif ptype == "boolean":
            value = str(value).lower() in ("true", "1", "yes")
        out[name] = value
    return out


def lambda_handler(event: dict, context: Any) -> dict:  # noqa: ANN401
    """Bedrock Agent action-group entry point.

    Expected event shape:
        {
            "messageVersion": "1.0",
            "actionGroup": "FieldDiscovery",
            "function": "search_source" | "search_all_sources",
            "parameters": [{"name": ..., "type": ..., "value": ...}, ...]
        }
    """
    message_version = event.get("messageVersion", "1.0")
    action_group = event.get("actionGroup", "")
    function = event.get("function", "")
    parameters = event.get("parameters", [])

    logger.info("Invoked: actionGroup=%s function=%s", action_group, function)

    try:
        kwargs = _parse_params(parameters)

        if function == "search_source":
            source_name = kwargs.get("source_name", "")
            query = kwargs.get("query", "")
            since_days = int(kwargs.get("since_days", 90))
            result = search_source(source_name, query, since_days)

        elif function == "search_all_sources":
            oem = kwargs.get("oem", "Stellantis")
            models_raw = kwargs.get("models", [])
            if isinstance(models_raw, str):
                models_raw = [m.strip() for m in models_raw.split(",") if m.strip()]
            since_days = int(kwargs.get("since_days", 90))
            result = search_all_sources(oem, models_raw, since_days)

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

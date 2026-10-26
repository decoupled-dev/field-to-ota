"""Tests for FEAT-001: field-discovery Lambda primitives.

Runs fully offline — no AWS, no Tavily, no network calls.
"""
import json
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Ensure repo root is on sys.path so 'infra' is importable as a package.
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


# ---------------------------------------------------------------------------
# Imports under test
# ---------------------------------------------------------------------------
from infra.lambda_.field_discovery.handler import (  # noqa: E402
    DISCOVERY_SOURCES,
    lambda_handler as handler_lambda_handler,
    search_source,
    search_all_sources,
)
from infra.lambda_.field_discovery.ingest import (  # noqa: E402
    deduplicate_issues,
    ingest_issues,
    lambda_handler as ingest_lambda_handler,
)


# ===========================================================================
# seed data
# ===========================================================================

class TestSeedData:
    SEED_PATH = REPO_ROOT / "data" / "stellantis_seed_issues.json"

    def test_seed_file_exists(self):
        assert self.SEED_PATH.exists(), f"Seed file not found: {self.SEED_PATH}"

    def test_seed_has_15_issues(self):
        data = json.loads(self.SEED_PATH.read_text())
        assert len(data) >= 15, f"Expected >= 15 issues, got {len(data)}"

    def test_seed_has_mvp_hero(self):
        data = json.loads(self.SEED_PATH.read_text())
        actionable = [i for i in data if i.get("is_actionable_in_mvp")]
        assert len(actionable) >= 1, "No is_actionable_in_mvp=true issue found"
        titles = [i["title"].lower() for i in actionable]
        assert any("bluetooth" in t and ("cold" in t or "stutter" in t) for t in titles), (
            f"MVP hero Bluetooth/cold-start issue not found in: {titles}"
        )

    def test_seed_schema(self):
        required_keys = {
            "id", "title", "source", "url", "severity",
            "frequency_score", "affected_models", "raw_count",
            "summary", "is_actionable_in_mvp", "tags",
        }
        data = json.loads(self.SEED_PATH.read_text())
        for issue in data:
            missing = required_keys - set(issue.keys())
            assert not missing, f"Issue {issue.get('id')} missing keys: {missing}"

    def test_seed_bundle_copy_exists(self):
        bundle_path = REPO_ROOT / "infra" / "lambda_" / "field_discovery" / "data" / "stellantis_seed_issues.json"
        assert bundle_path.exists(), f"Seed not copied to Lambda bundle: {bundle_path}"


# ===========================================================================
# DISCOVERY_SOURCES
# ===========================================================================

class TestSources:
    REQUIRED_CATEGORIES = {
        "nhtsa",
        "forum_jeep",
        "reddit_jeep",
        "app_store_google",
        "review_carcomplaints",
        "social_twitter",
    }

    def test_sources_count(self):
        assert len(DISCOVERY_SOURCES) >= 14, (
            f"Expected >= 14 sources, got {len(DISCOVERY_SOURCES)}"
        )

    def test_sources_required_categories(self):
        cats = {s["category"] for s in DISCOVERY_SOURCES}
        missing = self.REQUIRED_CATEGORIES - cats
        assert not missing, f"Missing required categories: {missing} — found: {cats}"

    def test_sources_schema(self):
        required_keys = {"name", "url_template", "category", "requires_auth", "simulated_fallback"}
        for src in DISCOVERY_SOURCES:
            missing = required_keys - set(src.keys())
            assert not missing, f"Source {src.get('name')} missing keys: {missing}"

    def test_sources_unique_names(self):
        names = [s["name"] for s in DISCOVERY_SOURCES]
        assert len(names) == len(set(names)), "Duplicate source names found"


# ===========================================================================
# deduplicate_issues
# ===========================================================================

class TestDedup:
    def test_dedup_basic(self):
        issues = [
            {"id": "1", "title": "Bluetooth stutter cold start", "raw_count": 5, "source": "reddit"},
            {"id": "2", "title": "Bluetooth stutter after cold boot", "raw_count": 3, "source": "reddit"},
        ]
        survivors, merged = deduplicate_issues(issues)
        assert len(survivors) == 1, f"Expected 1 survivor, got {survivors}"
        assert survivors[0]["raw_count"] == 5, f"Expected raw_count=5, got {survivors[0]['raw_count']}"

    def test_dedup_keeps_highest_raw_count(self):
        issues = [
            {"id": "a", "title": "Nav map freeze during route", "raw_count": 10, "source": "forum"},
            {"id": "b", "title": "Nav map freezes during routing", "raw_count": 25, "source": "nhtsa"},
        ]
        survivors, _ = deduplicate_issues(issues)
        assert len(survivors) == 1
        assert survivors[0]["raw_count"] == 25

    def test_dedup_distinct_issues_preserved(self):
        issues = [
            {"id": "1", "title": "Bluetooth audio drops", "raw_count": 10, "source": "reddit"},
            {"id": "2", "title": "OTA update stuck at 83 percent", "raw_count": 5, "source": "nhtsa"},
            {"id": "3", "title": "CarPlay not detected after iOS update", "raw_count": 8, "source": "forum"},
        ]
        survivors, merged = deduplicate_issues(issues)
        assert len(survivors) == 3, f"Distinct issues should all survive: {survivors}"
        assert merged == []

    def test_dedup_empty_list(self):
        survivors, merged = deduplicate_issues([])
        assert survivors == []
        assert merged == []

    def test_dedup_single_item(self):
        issues = [{"id": "x", "title": "Something", "raw_count": 1, "source": "test"}]
        survivors, merged = deduplicate_issues(issues)
        assert len(survivors) == 1
        assert merged == []

    def test_dedup_returns_tuple(self):
        result = deduplicate_issues([{"id": "1", "title": "Test", "raw_count": 1, "source": "x"}])
        assert isinstance(result, tuple) and len(result) == 2


# ===========================================================================
# handler lambda_handler protocol
# ===========================================================================

class TestHandlerProtocol:
    def _make_event(self, function: str, params: list[dict]) -> dict:
        return {
            "messageVersion": "1.0",
            "actionGroup": "FieldDiscovery",
            "function": function,
            "parameters": params,
        }

    def test_search_source_response_shape(self):
        event = self._make_event(
            "search_source",
            [
                {"name": "source_name", "type": "string", "value": "nhtsa"},
                {"name": "query", "type": "string", "value": "bluetooth stutter"},
                {"name": "since_days", "type": "integer", "value": "90"},
            ],
        )
        resp = handler_lambda_handler(event, None)
        assert "response" in resp
        assert "functionResponse" in resp["response"]
        assert "responseBody" in resp["response"]["functionResponse"]
        assert "TEXT" in resp["response"]["functionResponse"]["responseBody"]
        body = resp["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
        parsed = json.loads(body)
        assert "source_name" in parsed
        assert "results" in parsed
        assert "simulated" in parsed

    def test_search_all_sources_response_shape(self):
        event = self._make_event(
            "search_all_sources",
            [
                {"name": "oem", "type": "string", "value": "Stellantis"},
                {"name": "models", "type": "array", "value": '["Jeep Grand Cherokee"]'},
                {"name": "since_days", "type": "integer", "value": "90"},
            ],
        )
        resp = handler_lambda_handler(event, None)
        assert "response" in resp
        body = json.loads(
            resp["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
        )
        assert "issues" in body
        assert "sources" in body
        assert "total" in body

    def test_message_version_echoed(self):
        event = self._make_event("search_source", [
            {"name": "source_name", "type": "string", "value": "nhtsa"},
            {"name": "query", "type": "string", "value": "test"},
        ])
        event["messageVersion"] = "1.0"
        resp = handler_lambda_handler(event, None)
        assert resp["messageVersion"] == "1.0"

    def test_unknown_function_returns_error(self):
        event = self._make_event("nonexistent_fn", [])
        resp = handler_lambda_handler(event, None)
        body = json.loads(
            resp["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
        )
        assert "error" in body


# ===========================================================================
# ingest lambda_handler protocol
# ===========================================================================

class TestIngestProtocol:
    def _make_event(self, function: str, params: list[dict]) -> dict:
        return {
            "messageVersion": "1.0",
            "actionGroup": "FieldDiscoveryIngest",
            "function": function,
            "parameters": params,
        }

    def test_ingest_issues_response_shape(self):
        issues = [
            {"id": "1", "title": "Bluetooth stutter cold start", "raw_count": 5, "source": "reddit"},
            {"id": "2", "title": "Bluetooth stutter after cold boot", "raw_count": 3, "source": "reddit"},
        ]
        event = self._make_event(
            "ingest_issues",
            [
                {"name": "oem", "type": "string", "value": "Stellantis"},
                {"name": "issues_json", "type": "string", "value": json.dumps(issues)},
            ],
        )
        resp = ingest_lambda_handler(event, None)
        assert "response" in resp
        assert "functionResponse" in resp["response"]
        body = json.loads(
            resp["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
        )
        # TABLE not set in test env → stored=0 but structure must be correct
        assert "stored" in body
        assert "deduplicated" in body
        assert "clusters" in body

    def test_ingest_dedup_applied(self):
        issues = [
            {"id": "1", "title": "Bluetooth stutter cold start", "raw_count": 5, "source": "reddit"},
            {"id": "2", "title": "Bluetooth stutter after cold boot", "raw_count": 3, "source": "reddit"},
            {"id": "3", "title": "OTA stuck at 83 percent", "raw_count": 20, "source": "nhtsa"},
        ]
        result = ingest_issues("Stellantis", json.dumps(issues))
        assert result["deduplicated"] == 1, f"Expected 1 dedup, got {result['deduplicated']}"

    def test_ingest_invalid_json(self):
        result = ingest_issues("Stellantis", "not-valid-json{{{")
        assert "error" in result

    def test_ingest_message_version_echoed(self):
        event = self._make_event("ingest_issues", [
            {"name": "oem", "type": "string", "value": "Stellantis"},
            {"name": "issues_json", "type": "string", "value": "[]"},
        ])
        resp = ingest_lambda_handler(event, None)
        assert resp["messageVersion"] == "1.0"

    def test_ingest_unknown_function(self):
        event = self._make_event("unknown_fn", [])
        resp = ingest_lambda_handler(event, None)
        body = json.loads(
            resp["response"]["functionResponse"]["responseBody"]["TEXT"]["body"]
        )
        assert "error" in body

"""Tests for FEAT-002: Field Discovery connector + Lambda handlers.

Runs fully offline — no Bedrock, no DynamoDB, no AWS credentials needed.
"""
import os
import sys
import tempfile

# Set env vars BEFORE any app imports (mirrors test_e2e.py pattern)
os.environ["F2F_LLM"] = "offline"
os.environ["F2F_DEMO_PACE"] = "0.0"
os.environ["F2F_STATE_DIR"] = tempfile.mkdtemp(prefix="f2f-fd-test-")
os.environ["F2F_KEYS_DIR"] = os.path.join(os.environ["F2F_STATE_DIR"], "keys")

# Make the repo root importable so infra.lambda_. paths resolve
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backend.app.connectors.field_discovery import field_discovery_connector  # noqa: E402
from infra.lambda_.field_discovery.ingest import deduplicate_issues  # noqa: E402
from infra.lambda_.field_discovery.handler import DISCOVERY_SOURCES  # noqa: E402


# ---------------------------------------------------------------------------
# Connector tests
# ---------------------------------------------------------------------------


def test_simulated_connector_returns_issues():
    """SimulatedFieldDiscovery.discover() must return at least one issue."""
    conn = field_discovery_connector()
    result = conn.discover("Stellantis", ["Jeep", "Dodge"], 30)
    assert "issues" in result
    assert len(result["issues"]) > 0, "Expected at least one issue from seed data"


def test_simulated_flag_is_true():
    """In offline mode the connector must report simulated=True."""
    conn = field_discovery_connector()
    assert conn.simulated is True
    assert conn.info.status == "simulated"


def test_discover_response_shape():
    """discover() response must contain 'issues', 'sources', and 'simulated' keys."""
    conn = field_discovery_connector()
    result = conn.discover("Stellantis", ["Jeep", "Dodge"], 30)
    assert "issues" in result
    assert "sources" in result
    assert "simulated" in result
    assert result["simulated"] is True
    # Each source entry must have required keys
    for src in result["sources"]:
        assert "name" in src
        assert "category" in src
        assert "simulated" in src
        assert "count" in src


# ---------------------------------------------------------------------------
# Deduplication tests (infra.lambda_.field_discovery.ingest)
# ---------------------------------------------------------------------------


def test_deduplication_merges_similar_titles():
    """Near-identical titles (ratio > 0.70) should be merged into one survivor."""
    issues = [
        {"id": "1", "title": "Bluetooth stutter cold start", "raw_count": 5, "source": "reddit"},
        {"id": "2", "title": "Bluetooth stutter after cold boot", "raw_count": 3, "source": "reddit"},
    ]
    survivors, merged = deduplicate_issues(issues)
    assert len(survivors) == 1, f"Expected 1 survivor, got {len(survivors)}: {survivors}"
    assert survivors[0]["raw_count"] == 5, "Should keep the entry with the highest raw_count"


def test_deduplication_keeps_distinct_titles():
    """Issues with dissimilar titles must all survive deduplication."""
    issues = [
        {"id": "1", "title": "Bluetooth stutter cold start", "raw_count": 5, "source": "reddit"},
        {"id": "2", "title": "OTA update stuck at 83 percent", "raw_count": 3, "source": "nhtsa"},
        {"id": "3", "title": "Backup camera latency over two seconds", "raw_count": 2, "source": "forum"},
    ]
    survivors, merged = deduplicate_issues(issues)
    assert len(survivors) == 3, f"Expected 3 survivors for distinct titles, got {len(survivors)}"
    assert merged == [], f"Expected no merges for distinct titles, got {merged}"


# ---------------------------------------------------------------------------
# Source coverage test (infra.lambda_.field_discovery.handler)
# ---------------------------------------------------------------------------


def test_discovery_sources_cover_required_categories():
    """DISCOVERY_SOURCES must cover all required categories."""
    required = {
        "nhtsa",
        "forum_jeep",
        "reddit_jeep",
        "app_store_google",
        "review_carcomplaints",
        "social_twitter",
    }
    present = {s["category"] for s in DISCOVERY_SOURCES}
    missing = required - present
    assert not missing, f"Missing required source categories: {missing}"
    assert len(DISCOVERY_SOURCES) >= 14, (
        f"Expected >= 14 sources, found {len(DISCOVERY_SOURCES)}"
    )

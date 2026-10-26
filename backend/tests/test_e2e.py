"""End-to-end: field signals → case → all 12 stages → OTA on the device plane → closed.

Runs fully offline (no Bedrock, Jira, GitHub or AWS) with an isolated state dir.
"""
import os
import tempfile
import threading
import time

os.environ["F2F_STATE_DIR"] = tempfile.mkdtemp(prefix="f2f-test-")
os.environ["F2F_KEYS_DIR"] = os.path.join(os.environ["F2F_STATE_DIR"], "keys")
os.environ["F2F_DEMO_PACE"] = "0.0"
os.environ["F2F_LLM"] = "offline"

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.agents import stages as stage_mod  # noqa: E402
from backend.app.main import app  # noqa: E402

stage_mod.DEVICE_WAIT_S = 2  # no real hu-sentinel in tests: fall back to the virtual vehicle


def _wait(client, case_id, pred, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        d = client.get(f"/api/cases/{case_id}").json()
        if pred(d):
            return d
        time.sleep(0.2)
    raise AssertionError(f"timeout; last state {d['case']['status']}")


def test_forum_post_triggers_full_pipeline():
    with TestClient(app) as client:
        client.post("/api/demo/reset")
        clusters = client.get("/api/clusters").json()
        target = next(c for c in clusters if c["component"] == "media-service")
        assert target["authors"] == 5 and target["case_id"] is None  # seeded just under the threshold

        client.post("/api/forum/posts", json={"author": "winterdriver_ch", "title": "Cold start: Bluetooth music crackles",
                                              "body": "Every morning at -5C music crackles after start, then Android Auto reconnects. HU-2.3.1"})
        end = time.time() + 15
        case_id = None
        while time.time() < end and not case_id:
            case_id = next((c["id"] for c in client.get("/api/cases").json() if c["status"] != "closed"), None)
            time.sleep(0.3)
        assert case_id, "forum post did not open a case"

        d = _wait(client, case_id, lambda d: d["case"]["status"] in ("awaiting_approval", "failed"))
        assert d["case"]["status"] == "awaiting_approval", [(s["stage"], s["status"], s["logs"][-1:]) for s in d["stages"]]
        assert client.post(f"/api/cases/{case_id}/approve", json={"approver": "test"}).status_code == 200

        d = _wait(client, case_id, lambda d: d["case"]["status"] in ("closed", "failed"))
        statuses = {s["stage"]: s["status"] for s in d["stages"]}
        assert d["case"]["status"] == "closed", statuses
        assert set(statuses.values()) == {"passed"}
        assert d["case"]["fixed_version"] == "HU-2.3.2"
        assert d["case"]["fixed_vins"] == d["case"]["affected_vins"] > 0
        verify = next(s for s in d["stages"] if s["stage"] == "verify")
        assert verify["outputs"]["baseline_detects_defect"] is True
        for kind in ("evidence", "rca", "fleet"):
            assert client.get(f"/api/cases/{case_id}/reports/{kind}").status_code == 200
        assert "Apex Motors Support" in client.get("/forum").text

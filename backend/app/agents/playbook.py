"""Offline fix playbook for the A2DP startup race.

Used when Bedrock is unavailable, or when the model-generated patch fails the regression tests.
Each entry is a precise, reviewable edit; the verification stage judges it like any other patch.
"""
from __future__ import annotations

from pathlib import Path

CONFIG_OLD = """# How long A2DP startup waits for the audio HAL before streaming.
AUDIO_HAL_READY_TIMEOUT_MS = 200"""
CONFIG_NEW = """# Upper bound A2DP startup waits for the audio HAL onReady callback (REQ-MEDIA-021 rev B).
# Streaming never starts on an unready HAL; past this bound startup is deferred, not forced.
AUDIO_HAL_READY_TIMEOUT_MS = 1500"""

MANAGER_OLD = """        # Wait for the HAL, but never longer than the startup timeout.
        stream_start = min(config.AUDIO_HAL_READY_TIMEOUT_MS, hal_ready_ms)
        if stream_start < hal_ready_ms:
            events.append((stream_start, "W", "A2dpManager",
                           f"audio HAL not ready after {config.AUDIO_HAL_READY_TIMEOUT_MS}ms, starting stream anyway"))
        events.append((stream_start, "I", "A2dpManager", "A2DP stream started codec=AAC 44100Hz"))"""
MANAGER_NEW = """        # Stream only once the HAL has reported ready. Starting early starves the sink
        # (underruns -> A2DP stall -> projection drop), so past the timeout we defer instead.
        if hal_ready_ms > config.AUDIO_HAL_READY_TIMEOUT_MS:
            events.append((config.AUDIO_HAL_READY_TIMEOUT_MS, "W", "A2dpManager",
                           f"audio HAL not ready after {config.AUDIO_HAL_READY_TIMEOUT_MS}ms, deferring stream until onReady"))
        stream_start = hal_ready_ms
        events.append((stream_start, "I", "A2dpManager", "A2DP stream started codec=AAC 44100Hz"))"""

TEST_FILE = "tests/test_cold_start_regression.py"
TEST_CONTENT = '''"""Regression tests for F2F field defect: A2DP underruns at cold start (REQ-MEDIA-021 rev B)."""
import pytest

from media_service.a2dp_manager import A2dpManager
from sim_thermal import hal_ready_ms


@pytest.mark.parametrize("ambient_c", [-20, -15, -10, -8, -5, 0, 5, 20])
def test_no_underruns_across_ambient_range(ambient_c):
    result = A2dpManager().cold_start(hal_ready_ms=hal_ready_ms(ambient_c))
    assert result.underruns == 0, f"{result.underruns} underruns at {ambient_c} C"
    assert not result.projection_lost


def test_stream_waits_for_hal_ready():
    result = A2dpManager().cold_start(hal_ready_ms=970)
    assert result.stream_start_ms >= 970


def test_slow_hal_defers_instead_of_forcing_stream():
    result = A2dpManager().cold_start(hal_ready_ms=2400)
    assert result.underruns == 0
    assert any("deferring stream" in e[3] for e in result.events)
'''

# The thermal model the tests import, vendored so the component repo stays self-contained.
THERMAL_FILE = "tests/sim_thermal.py"

REQ_OLD = "The audio stream shall start no later than 200 ms after A2DP sink init."
REQ_NEW = ("The audio stream shall start only after the audio HAL reports ready. The media service shall wait up to\n"
           "1500 ms for HAL readiness and shall defer, not force, streaming when the HAL is slower (rev B, F2F field defect).")
REQ_VERIFY_ADD = ("- TC-MEDIA-021-02: cold boot across ambient −20 °C … +20 °C (HAL ready 120–1570 ms), zero underruns, no projection loss.\n"
                  "- TC-MEDIA-021-03: HAL slower than the wait bound defers streaming instead of starting on an unready HAL.\n")


def apply_code_fix(repo: Path, thermal_src: str) -> list[str]:
    changed = []
    for rel, old, new in (("media_service/config.py", CONFIG_OLD, CONFIG_NEW),
                          ("media_service/a2dp_manager.py", MANAGER_OLD, MANAGER_NEW)):
        p = repo / rel
        text = p.read_text()
        if old not in text:
            raise ValueError(f"playbook anchor not found in {rel}")
        p.write_text(text.replace(old, new))
        changed.append(rel)
    (repo / TEST_FILE).write_text(TEST_CONTENT)
    (repo / THERMAL_FILE).write_text(thermal_src)
    (repo / "VERSION").write_text("2.3.2\n")
    init = repo / "media_service" / "__init__.py"
    init.write_text(init.read_text().replace("2.3.1", "2.3.2"))
    return changed + [TEST_FILE, THERMAL_FILE, "VERSION", "media_service/__init__.py"]


def apply_requirement_fix(repo: Path, case_id: str) -> None:
    p = repo / "docs" / "requirements" / "REQ-MEDIA-021.md"
    text = p.read_text()
    text = text.replace(REQ_OLD, REQ_NEW)
    text = text.replace("| Status | Released (HU-2.3.0) |", f"| Status | Rev B, pending release HU-2.3.2 ({case_id}) |")
    text = text.replace("- TC-MEDIA-021-01: warm boot (ambient 20 °C), audio resumes without underruns.\n",
                        "- TC-MEDIA-021-01: warm boot (ambient 20 °C), audio resumes without underruns.\n" + REQ_VERIFY_ADD)
    p.write_text(text)

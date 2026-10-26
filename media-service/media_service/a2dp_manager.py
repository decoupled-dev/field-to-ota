"""A2DP sink startup sequencing.

The manager is deterministic: given when the audio HAL becomes ready, it produces
the sequence of log events the service emits during boot. The head-unit simulator
and the tests both drive it this way.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config


@dataclass
class BootResult:
    stream_start_ms: int
    underruns: int
    reconnects: int
    projection_lost: bool
    events: list[tuple[int, str, str, str]] = field(default_factory=list)  # (t_ms, level, tag, msg)


class A2dpManager:
    def __init__(self, device: str = "Pixel 8"):
        self.device = device

    def cold_start(self, hal_ready_ms: int) -> BootResult:
        events: list[tuple[int, str, str, str]] = []
        events.append((0, "I", "A2dpManager", f"A2DP sink init, device={self.device}"))
        events.append((hal_ready_ms, "I", "AudioHAL", f"audio HAL ready after {hal_ready_ms}ms"))

        # Wait for the HAL, but never longer than the startup timeout.
        stream_start = min(config.AUDIO_HAL_READY_TIMEOUT_MS, hal_ready_ms)
        if stream_start < hal_ready_ms:
            events.append((stream_start, "W", "A2dpManager",
                           f"audio HAL not ready after {config.AUDIO_HAL_READY_TIMEOUT_MS}ms, starting stream anyway"))
        events.append((stream_start, "I", "A2dpManager", "A2DP stream started codec=AAC 44100Hz"))

        underruns = 0
        reconnects = 0
        t = stream_start
        while t < hal_ready_ms:
            underruns += 1
            events.append((t, "W", "AudioFlinger", f"track a2dp_out: underrun, frames=0 (count={underruns})"))
            if underruns % config.A2DP_STALL_UNDERRUN_LIMIT == 0:
                reconnects += 1
                events.append((t, "E", "BluetoothA2dp", f"A2DP sink stalled, reconnecting (attempt {reconnects})"))
            t += config.BUFFER_PERIOD_MS

        projection_lost = reconnects > 0
        if projection_lost:
            events.append((t, "E", "CarProjection", "Android Auto projection lost: audio focus timeout"))
            events.append((t + 30_000, "I", "CarProjection", "Android Auto projection restored"))
        events.sort(key=lambda e: e[0])
        return BootResult(stream_start, underruns, reconnects, projection_lost, events)

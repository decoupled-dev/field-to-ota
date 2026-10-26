"""Hardware timing model: audio HAL readiness vs. ambient temperature (eMMC throughput derating)."""


def hal_ready_ms(temp_c: float) -> int:
    if temp_c >= 10:
        return 120
    if temp_c >= 0:
        return int(120 + (10 - temp_c) * 25)  # 120..370 ms
    return int(370 + (-temp_c) * 60)  # -10 °C -> 970 ms

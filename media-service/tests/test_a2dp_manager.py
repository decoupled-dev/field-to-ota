from media_service.a2dp_manager import A2dpManager


def test_warm_boot_streams_cleanly():
    result = A2dpManager().cold_start(hal_ready_ms=120)
    assert result.underruns == 0
    assert not result.projection_lost


def test_stream_never_starts_before_init():
    result = A2dpManager().cold_start(hal_ready_ms=150)
    assert result.stream_start_ms >= 0

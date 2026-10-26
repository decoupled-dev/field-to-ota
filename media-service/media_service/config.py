"""Startup tuning for the media service."""

# How long A2DP startup waits for the audio HAL before streaming.
AUDIO_HAL_READY_TIMEOUT_MS = 200

# Size of one audio buffer period; one underrun is logged per starved period.
BUFFER_PERIOD_MS = 20

# The Bluetooth stack drops the sink after this many consecutive underruns.
A2DP_STALL_UNDERRUN_LIMIT = 25

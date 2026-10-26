# Design: Audio startup sequencing (media-service)

1. `A2dpManager` initializes the A2DP sink at boot.
2. It waits up to `AUDIO_HAL_READY_TIMEOUT_MS` for the audio HAL `onReady` callback.
3. If the timeout elapses first, streaming starts anyway so that audio latency stays low.
4. `AudioFlinger` logs an underrun for every buffer period (20 ms) the HAL cannot consume.
5. After 25 consecutive underruns the Bluetooth stack treats the sink as stalled and reconnects; Android Auto projection drops audio focus.

HAL readiness depends on eMMC read throughput, which degrades at low temperatures (see HW-NOTE-117).

package health

import "testing"

func TestBootReport(t *testing.T) {
	var tr Tracker
	lines := []string{
		"10-26 21:11:44.906  1120  1157 I CarService: ignition ON, ambient=-7.8C, hu_sw=HU-2.3.1",
		"E BluetoothA2dp: A2DP sink stalled, reconnecting (attempt 1)",
		"I ActivityManager: boot completed, audio underruns=32",
	}
	var r *BootReport
	for _, l := range lines {
		r = tr.Feed(l)
	}
	if r == nil || r.Underruns != 32 || r.Reconnects != 1 || r.AmbientC == nil || *r.AmbientC != -7.8 || r.SWVersion != "HU-2.3.1" {
		t.Fatalf("unexpected report %+v", r)
	}
}

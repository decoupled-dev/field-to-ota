// Package health derives per-boot health metrics from the log stream.
package health

import (
	"regexp"
	"strconv"
	"sync"
)

var (
	bootDone  = regexp.MustCompile(`boot completed, audio underruns=(\d+)`)
	ignition  = regexp.MustCompile(`ignition ON(?:, ambient=(-?[\d.]+)C)?(?:, hu_sw=(\S+))?`)
	reconnect = regexp.MustCompile(`BluetoothA2dp: .*reconnecting`)
)

type BootReport struct {
	Underruns  int
	Reconnects int
	AmbientC   *float64
	SWVersion  string // build that ran this boot, from the ignition line; empty if not logged
}

// Tracker counts A2DP reconnects between ignition and boot completion.
type Tracker struct {
	mu         sync.Mutex
	reconnects int
	ambient    *float64
	sw         string
}

// Feed returns a report when the line marks the end of a boot.
func (t *Tracker) Feed(line string) *BootReport {
	t.mu.Lock()
	defer t.mu.Unlock()
	if m := ignition.FindStringSubmatch(line); m != nil {
		t.reconnects = 0
		t.ambient = nil
		t.sw = m[2]
		if m[1] != "" {
			if v, err := strconv.ParseFloat(m[1], 64); err == nil {
				t.ambient = &v
			}
		}
		return nil
	}
	if reconnect.MatchString(line) {
		t.reconnects++
		return nil
	}
	if m := bootDone.FindStringSubmatch(line); m != nil {
		n, _ := strconv.Atoi(m[1])
		r := &BootReport{Underruns: n, Reconnects: t.reconnects, AmbientC: t.ambient, SWVersion: t.sw}
		t.reconnects = 0
		return r
	}
	return nil
}

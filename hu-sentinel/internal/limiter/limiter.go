// Package limiter caps uploads per sliding hour so a noisy rule can't flood the uplink.
package limiter

import (
	"sync"
	"time"
)

type Hourly struct {
	mu   sync.Mutex
	max  int
	sent []time.Time
}

func NewHourly(max int) *Hourly { return &Hourly{max: max} }

// Allow records and permits an upload at t if fewer than max happened in the last hour.
func (h *Hourly) Allow(t time.Time) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	cutoff := t.Add(-time.Hour)
	i := 0
	for i < len(h.sent) && h.sent[i].Before(cutoff) {
		i++
	}
	h.sent = h.sent[i:]
	if h.max > 0 && len(h.sent) >= h.max {
		return false
	}
	h.sent = append(h.sent, t)
	return true
}

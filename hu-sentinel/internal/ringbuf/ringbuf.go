// Package ringbuf keeps the most recent log lines in a fixed-size, age-bounded buffer.
package ringbuf

import (
	"sync"
	"time"
)

type Entry struct {
	T    time.Time
	Line string
}

// Ring is a bounded circular buffer: at most Cap lines, and Snapshot drops lines older than MaxAge.
type Ring struct {
	mu     sync.Mutex
	buf    []Entry
	next   int
	full   bool
	MaxAge time.Duration
}

func New(capacity int, maxAge time.Duration) *Ring {
	if capacity < 1 {
		capacity = 1
	}
	return &Ring{buf: make([]Entry, capacity), MaxAge: maxAge}
}

func (r *Ring) Add(t time.Time, line string) {
	r.mu.Lock()
	r.buf[r.next] = Entry{T: t, Line: line}
	r.next = (r.next + 1) % len(r.buf)
	if r.next == 0 {
		r.full = true
	}
	r.mu.Unlock()
}

func (r *Ring) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.full {
		return len(r.buf)
	}
	return r.next
}

// Snapshot returns lines (oldest first) newer than now-MaxAge.
func (r *Ring) Snapshot(now time.Time) []Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	var ordered []Entry
	if r.full {
		ordered = append(ordered, r.buf[r.next:]...)
	}
	ordered = append(ordered, r.buf[:r.next]...)
	if r.MaxAge <= 0 {
		return ordered
	}
	cutoff := now.Add(-r.MaxAge)
	i := 0
	for i < len(ordered) && ordered[i].T.Before(cutoff) {
		i++
	}
	return ordered[i:]
}

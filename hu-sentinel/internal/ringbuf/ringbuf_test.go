package ringbuf

import (
	"fmt"
	"testing"
	"time"
)

func TestRingWrapsAndKeepsOrder(t *testing.T) {
	r := New(3, 0)
	base := time.Now()
	for i := 0; i < 5; i++ {
		r.Add(base.Add(time.Duration(i)*time.Second), fmt.Sprint(i))
	}
	s := r.Snapshot(base)
	if len(s) != 3 || s[0].Line != "2" || s[2].Line != "4" {
		t.Fatalf("unexpected snapshot %+v", s)
	}
}

func TestRingDropsOldLines(t *testing.T) {
	r := New(10, 60*time.Second)
	base := time.Now()
	r.Add(base.Add(-90*time.Second), "old")
	r.Add(base.Add(-10*time.Second), "new")
	s := r.Snapshot(base)
	if len(s) != 1 || s[0].Line != "new" {
		t.Fatalf("expected only new line, got %+v", s)
	}
}

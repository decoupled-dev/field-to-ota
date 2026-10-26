package queue

import (
	"errors"
	"testing"

	"github.com/field-to-fix/hu-sentinel/internal/uplink"
)

func TestSpoolEvictsOldestAndDrains(t *testing.T) {
	s, _ := New(t.TempDir(), 2500)
	for _, id := range []string{"A", "B", "C"} {
		s.Put(uplink.EventMeta{RuleID: id}, make([]byte, 1000))
	}
	if s.Len() != 2 {
		t.Fatalf("expected oldest evicted, have %d", s.Len())
	}
	var got []string
	fail := true
	send := func(m uplink.EventMeta, _ []byte) error {
		if fail {
			fail = false
			return errors.New("offline")
		}
		got = append(got, m.RuleID)
		return nil
	}
	if n, err := s.Drain(send); err == nil || n != 0 {
		t.Fatal("first drain should stop on failure")
	}
	if n, _ := s.Drain(send); n != 2 || got[0] != "B" || got[1] != "C" {
		t.Fatalf("drained %d %v", n, got)
	}
}

// Package queue is an on-disk spool for bundles that could not be uploaded (no connectivity).
package queue

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/field-to-fix/hu-sentinel/internal/uplink"
)

type Spool struct {
	mu       sync.Mutex
	Dir      string
	MaxBytes int64
}

func New(dir string, maxBytes int64) (*Spool, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &Spool{Dir: dir, MaxBytes: maxBytes}, nil
}

// Put stores an event; the oldest entries are evicted to stay under MaxBytes.
func (s *Spool) Put(meta uplink.EventMeta, bundle []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	base := fmt.Sprintf("%019d-%s", time.Now().UnixNano(), sanitize(meta.RuleID))
	mj, _ := json.Marshal(meta)
	if err := os.WriteFile(filepath.Join(s.Dir, base+".tgz"), bundle, 0o600); err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(s.Dir, base+".json"), mj, 0o600); err != nil {
		return err
	}
	return s.evict()
}

// Len returns the number of spooled events.
func (s *Spool) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.entries())
}

// Drain tries to send spooled events oldest-first and stops at the first failure.
func (s *Spool) Drain(send func(uplink.EventMeta, []byte) error) (sent int, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, base := range s.entries() {
		p := filepath.Join(s.Dir, base)
		mj, err1 := os.ReadFile(p + ".json")
		b, err2 := os.ReadFile(p + ".tgz")
		var meta uplink.EventMeta
		if err1 != nil || err2 != nil || json.Unmarshal(mj, &meta) != nil {
			s.remove(base) // corrupt entry
			continue
		}
		if err := send(meta, b); err != nil {
			return sent, err
		}
		s.remove(base)
		sent++
	}
	return sent, nil
}

func (s *Spool) entries() []string {
	ents, _ := os.ReadDir(s.Dir)
	var out []string
	for _, e := range ents {
		if n := e.Name(); strings.HasSuffix(n, ".json") {
			out = append(out, strings.TrimSuffix(n, ".json"))
		}
	}
	sort.Strings(out)
	return out
}

func (s *Spool) remove(base string) {
	os.Remove(filepath.Join(s.Dir, base+".json"))
	os.Remove(filepath.Join(s.Dir, base+".tgz"))
}

func (s *Spool) evict() error {
	ents := s.entries()
	var total int64
	sizes := make([]int64, len(ents))
	for i, base := range ents {
		for _, ext := range []string{".json", ".tgz"} {
			if st, err := os.Stat(filepath.Join(s.Dir, base+ext)); err == nil {
				sizes[i] += st.Size()
			}
		}
		total += sizes[i]
	}
	for i := 0; total > s.MaxBytes && i < len(ents); i++ {
		s.remove(ents[i])
		total -= sizes[i]
	}
	return nil
}

func sanitize(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == '_' || r >= '0' && r <= '9' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' {
			return r
		}
		return '_'
	}, s)
}

// Package rules is a small streaming rule engine: regex conditions counted over sliding windows.
package rules

import (
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// maxTracked bounds per-condition memory regardless of rule configuration.
const maxTracked = 512

// Condition matches a regex at least Count times within WindowS seconds.
type Condition struct {
	ID      string  `json:"id"`
	Match   string  `json:"match"`
	Count   int     `json:"count"`
	WindowS float64 `json:"window_s"`
	re      *regexp.Regexp
	hits    []time.Time
}

// Rule fires when its primary condition and every all_of condition hold at the same time.
type Rule struct {
	ID          string      `json:"id"`
	Description string      `json:"description"`
	Condition               // primary condition (match/count/window_s at the top level)
	AllOf       []Condition `json:"all_of,omitempty"`
	Severity    string      `json:"severity"`
	Capture     []string    `json:"capture"`
	CooldownS   float64     `json:"cooldown_s"`
	Summary     string      `json:"summary"` // template: {count}, {window_s}, {<cond id>}
	lastFired   time.Time
}

type File struct {
	Version int    `json:"version"`
	Rules   []Rule `json:"rules"`
}

// Trigger is the result of a rule firing.
type Trigger struct {
	Rule    *Rule
	At      time.Time
	Counts  map[string]int // condition id ("primary" for the main one) -> hits in window
	Summary string
}

type Engine struct {
	mu    sync.Mutex
	rules []*Rule
}

func Load(path string) (*Engine, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var f File
	if err := json.Unmarshal(b, &f); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return New(f.Rules)
}

func New(rs []Rule) (*Engine, error) {
	e := &Engine{}
	for i := range rs {
		r := rs[i]
		if r.ID == "" {
			return nil, fmt.Errorf("rule %d: missing id", i)
		}
		if err := r.Condition.compile(); err != nil {
			return nil, fmt.Errorf("rule %s: %w", r.ID, err)
		}
		if r.Condition.ID == "" {
			r.Condition.ID = "primary"
		}
		for j := range r.AllOf {
			if err := r.AllOf[j].compile(); err != nil {
				return nil, fmt.Errorf("rule %s all_of[%d]: %w", r.ID, j, err)
			}
		}
		e.rules = append(e.rules, &r)
	}
	return e, nil
}

func (c *Condition) compile() error {
	re, err := regexp.Compile(c.Match)
	if err != nil {
		return err
	}
	c.re = re
	if c.Count < 1 {
		c.Count = 1
	}
	if c.WindowS <= 0 {
		c.WindowS = 60
	}
	return nil
}

func (c *Condition) observe(t time.Time, line string) {
	if !c.re.MatchString(line) {
		return
	}
	c.hits = append(c.hits, t)
	if len(c.hits) > maxTracked {
		c.hits = c.hits[len(c.hits)-maxTracked:]
	}
}

func (c *Condition) inWindow(now time.Time) int {
	cutoff := now.Add(-time.Duration(c.WindowS * float64(time.Second)))
	i := 0
	for i < len(c.hits) && c.hits[i].Before(cutoff) {
		i++
	}
	c.hits = c.hits[i:]
	return len(c.hits)
}

func (c *Condition) reset() { c.hits = c.hits[:0] }

func (e *Engine) Rules() []*Rule { return e.rules }

// Feed evaluates one log line observed at t and returns any rules that fired.
func (e *Engine) Feed(t time.Time, line string) []Trigger {
	e.mu.Lock()
	defer e.mu.Unlock()
	var out []Trigger
	for _, r := range e.rules {
		r.Condition.observe(t, line)
		for j := range r.AllOf {
			r.AllOf[j].observe(t, line)
		}
		if !r.lastFired.IsZero() && t.Sub(r.lastFired) < time.Duration(r.CooldownS*float64(time.Second)) {
			continue
		}
		counts := map[string]int{r.Condition.ID: r.Condition.inWindow(t)}
		ok := counts[r.Condition.ID] >= r.Condition.Count
		for j := range r.AllOf {
			c := &r.AllOf[j]
			n := c.inWindow(t)
			counts[c.ID] = n
			if n < c.Count {
				ok = false
			}
		}
		if !ok {
			continue
		}
		r.lastFired = t
		r.Condition.reset()
		for j := range r.AllOf {
			r.AllOf[j].reset()
		}
		out = append(out, Trigger{Rule: r, At: t, Counts: counts, Summary: r.render(counts)})
	}
	return out
}

func (r *Rule) render(counts map[string]int) string {
	s := r.Summary
	if s == "" {
		s = r.ID + ": {count} matches in {window_s}s"
	}
	s = strings.ReplaceAll(s, "{count}", strconv.Itoa(counts[r.Condition.ID]))
	s = strings.ReplaceAll(s, "{window_s}", strconv.FormatFloat(r.Condition.WindowS, 'f', -1, 64))
	for id, n := range counts {
		s = strings.ReplaceAll(s, "{"+id+"}", strconv.Itoa(n))
	}
	return s
}

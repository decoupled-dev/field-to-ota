package rules

import (
	"testing"
	"time"
)

func underrunRule() Rule {
	return Rule{
		ID:        "BT_AUDIO_UNDERRUN",
		Condition: Condition{Match: `AudioFlinger: .*underrun`, Count: 20, WindowS: 10},
		AllOf:     []Condition{{ID: "A2DP_STALL", Match: `BluetoothA2dp: A2DP sink stalled`, Count: 1, WindowS: 10}},
		CooldownS: 60,
		Summary:   "{count} AudioFlinger underruns in {window_s}s + A2DP stall",
	}
}

const underrun = "W AudioFlinger: track a2dp_out: underrun, frames=0"
const stall = "E BluetoothA2dp: A2DP sink stalled, reconnecting (attempt 1)"

func TestWindowCounting(t *testing.T) {
	e, _ := New([]Rule{{ID: "R", Condition: Condition{Match: "boom", Count: 3, WindowS: 10}}})
	base := time.Now()
	// Three hits spread over 30s never fall inside one 10s window.
	for i := 0; i < 3; i++ {
		if tr := e.Feed(base.Add(time.Duration(i*15)*time.Second), "boom"); len(tr) != 0 {
			t.Fatalf("fired too early at hit %d", i)
		}
	}
	tr := append(e.Feed(base.Add(31*time.Second), "boom"), e.Feed(base.Add(32*time.Second), "boom")...)
	if len(tr) != 1 || tr[0].Counts["primary"] != 3 {
		t.Fatalf("expected one trigger with 3 hits, got %+v", tr)
	}
}

func TestAllOfRequiresEveryCondition(t *testing.T) {
	e, _ := New([]Rule{underrunRule()})
	base := time.Now()
	for i := 0; i < 30; i++ {
		if tr := e.Feed(base.Add(time.Duration(i)*20*time.Millisecond), underrun); len(tr) != 0 {
			t.Fatal("fired without the A2DP stall")
		}
	}
	tr := e.Feed(base.Add(700*time.Millisecond), stall)
	if len(tr) != 1 {
		t.Fatalf("expected trigger once stall seen, got %d", len(tr))
	}
	if got := tr[0].Summary; got != "30 AudioFlinger underruns in 10s + A2DP stall" {
		t.Fatalf("summary = %q", got)
	}
}

func TestCooldown(t *testing.T) {
	e, _ := New([]Rule{underrunRule()})
	fire := func(at time.Time) int {
		n := 0
		for i := 0; i < 20; i++ {
			n += len(e.Feed(at.Add(time.Duration(i)*time.Millisecond), underrun))
		}
		return n + len(e.Feed(at.Add(50*time.Millisecond), stall))
	}
	base := time.Now()
	if fire(base) != 1 {
		t.Fatal("first burst should fire")
	}
	if fire(base.Add(20*time.Second)) != 0 {
		t.Fatal("second burst inside cooldown must not fire")
	}
	if fire(base.Add(90*time.Second)) != 1 {
		t.Fatal("burst after cooldown should fire")
	}
}

func TestLoadDefaultRules(t *testing.T) {
	e, err := Load("../../rules.json")
	if err != nil {
		t.Fatal(err)
	}
	if len(e.Rules()) < 3 {
		t.Fatalf("expected >=3 default rules, got %d", len(e.Rules()))
	}
}

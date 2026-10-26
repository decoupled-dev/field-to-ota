package capture

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/field-to-fix/hu-sentinel/internal/ringbuf"
)

func TestBundleContentsAreScrubbed(t *testing.T) {
	now := time.Now()
	b, m, err := Build(Request{
		RuleID: "BT_AUDIO_UNDERRUN", Capture: []string{"logs_60s", "proc", "audio_15s"},
		Logs: []ringbuf.Entry{{T: now, Line: "BluetoothA2dp: connect 3C:5A:B4:01:9F:EE"}},
		Rule: map[string]string{"id": "x"}, Device: map[string]string{}, Proc: map[string]int{},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Missing) != 1 || m.Missing[0] != "audio_15s" {
		t.Fatalf("missing = %v", m.Missing)
	}
	gz, _ := gzip.NewReader(bytes.NewReader(b))
	tr := tar.NewReader(gz)
	seen := map[string]string{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		body, _ := io.ReadAll(tr)
		seen[h.Name] = string(body)
	}
	for _, f := range []string{"logs_60s.txt", "rule.json", "device.json", "proc.json", "manifest.json"} {
		if _, ok := seen[f]; !ok {
			t.Errorf("bundle missing %s", f)
		}
	}
	if strings.Contains(seen["logs_60s.txt"], "3C:5A") {
		t.Error("MAC address leaked into bundle")
	}
}

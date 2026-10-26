// Package capture builds the bug-report bundle (the dumpstate equivalent) for a fired rule.
package capture

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/field-to-fix/hu-sentinel/internal/ringbuf"
	"github.com/field-to-fix/hu-sentinel/internal/scrub"
)

// MaxAttachment bounds each optional media file so a bundle stays small over cellular.
const MaxAttachment = 8 << 20

type Request struct {
	RuleID    string
	Capture   []string
	Logs      []ringbuf.Entry
	Rule      any // serialized as rule.json
	Device    any // serialized as device.json
	Proc      any // serialized as proc.json
	Audio     string
	Screen    string
	Tombstone string
}

type Manifest struct {
	RuleID    string   `json:"rule_id"`
	CreatedAt string   `json:"created_at"`
	Files     []string `json:"files"`
	Missing   []string `json:"missing,omitempty"`
	Scrubbed  bool     `json:"pii_scrubbed"`
}

// Build returns a gzip-compressed tar bundle.
func Build(req Request, now time.Time) ([]byte, Manifest, error) {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	m := Manifest{RuleID: req.RuleID, CreatedAt: now.UTC().Format(time.RFC3339), Scrubbed: true}

	add := func(name string, data []byte) error {
		if err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(data)), ModTime: now}); err != nil {
			return err
		}
		_, err := tw.Write(data)
		m.Files = append(m.Files, name)
		return err
	}
	addJSON := func(name string, v any) error {
		b, err := json.MarshalIndent(v, "", "  ")
		if err != nil {
			return err
		}
		return add(name, b)
	}
	addFile := func(name, path string) error {
		if path == "" {
			m.Missing = append(m.Missing, name)
			return nil
		}
		st, err := os.Stat(path)
		if err != nil || st.Size() > MaxAttachment {
			m.Missing = append(m.Missing, name)
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			m.Missing = append(m.Missing, name)
			return nil
		}
		return add(name+filepath.Ext(path), b)
	}

	want := map[string]bool{}
	for _, c := range req.Capture {
		want[c] = true
	}
	var errs []error
	if want["logs_60s"] {
		var sb strings.Builder
		for _, e := range req.Logs {
			sb.WriteString(scrub.Line(e.Line))
			sb.WriteByte('\n')
		}
		errs = append(errs, add("logs_60s.txt", []byte(sb.String())))
	}
	errs = append(errs, addJSON("rule.json", req.Rule), addJSON("device.json", req.Device))
	if want["proc"] {
		errs = append(errs, addJSON("proc.json", req.Proc))
	}
	if want["audio_15s"] {
		errs = append(errs, addFile("audio_15s", req.Audio))
	}
	if want["screen_15s"] {
		errs = append(errs, addFile("screen_15s", req.Screen))
	}
	if want["tombstone"] {
		errs = append(errs, addFile("tombstone", req.Tombstone))
	}
	errs = append(errs, addJSON("manifest.json", m))
	for _, err := range errs {
		if err != nil {
			return nil, m, fmt.Errorf("bundle: %w", err)
		}
	}
	if err := tw.Close(); err != nil {
		return nil, m, err
	}
	if err := gz.Close(); err != nil {
		return nil, m, err
	}
	return buf.Bytes(), m, nil
}

package uplink

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// MaxArtifact bounds OTA downloads.
const MaxArtifact = 256 << 20

// HTTP talks to the Field-to-Fix backend directly (local demo, or behind API Gateway).
type HTTP struct {
	Base   string // e.g. http://127.0.0.1:8000
	Thing  string
	Client *http.Client
}

func NewHTTP(base, thing string) *HTTP {
	return &HTTP{Base: strings.TrimRight(base, "/"), Thing: thing, Client: &http.Client{Timeout: 30 * time.Second}}
}

func (h *HTTP) SendEvent(ctx context.Context, meta EventMeta, bundle []byte) error {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	mj, _ := json.Marshal(meta)
	if err := mw.WriteField("meta", string(mj)); err != nil {
		return err
	}
	fw, err := mw.CreateFormFile("bundle", fmt.Sprintf("%s-%d.tar.gz", meta.RuleID, int64(meta.TS)))
	if err != nil {
		return err
	}
	fw.Write(bundle)
	mw.Close()
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, h.Base+"/api/device/events", &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return h.do(req, nil)
}

func (h *HTTP) NextJob(ctx context.Context) (*Job, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, h.Base+"/api/device/"+url.PathEscape(h.Thing)+"/jobs/next", nil)
	resp, err := h.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusNotFound {
		return nil, ErrNoJob
	}
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("jobs/next: %s", resp.Status)
	}
	var j Job
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&j); err != nil {
		return nil, err
	}
	if j.JobID == "" {
		return nil, ErrNoJob
	}
	return &j, nil
}

func (h *HTTP) UpdateJob(ctx context.Context, jobID, status string, details map[string]string) error {
	return h.postJSON(ctx, "/api/device/"+url.PathEscape(h.Thing)+"/jobs/"+url.PathEscape(jobID),
		map[string]any{"status": status, "details": details})
}

func (h *HTTP) SendHealth(ctx context.Context, hl Health) error {
	return h.postJSON(ctx, "/api/device/"+url.PathEscape(h.Thing)+"/health", hl)
}

func (h *HTTP) Fetch(ctx context.Context, u string) ([]byte, error) {
	if strings.HasPrefix(u, "/") {
		u = h.Base + u
	}
	return fetch(ctx, h.Client, u)
}

func (h *HTTP) postJSON(ctx context.Context, path string, v any) error {
	b, _ := json.Marshal(v)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, h.Base+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	return h.do(req, nil)
}

func (h *HTTP) do(req *http.Request, out any) error {
	resp, err := h.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s %s: %s %s", req.Method, req.URL.Path, resp.Status, strings.TrimSpace(string(msg)))
	}
	if out != nil {
		return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	return nil
}

func fetch(ctx context.Context, c *http.Client, u string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("download %s: %s", u, resp.Status)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, MaxArtifact+1))
	if err != nil {
		return nil, err
	}
	if len(b) > MaxArtifact {
		return nil, fmt.Errorf("artifact exceeds %d bytes", MaxArtifact)
	}
	return b, nil
}

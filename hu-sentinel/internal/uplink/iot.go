package uplink

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// IoT uses the AWS IoT Core HTTPS data plane with the vehicle's X.509 certificate (mTLS on :8443).
// Events and health are published to MQTT topics over HTTPS (routed by IoT Rules to EventBridge);
// OTA uses the IoT Jobs HTTPS API. Bundles go to S3 through a presigned URL issued by the backend.
type IoT struct {
	Endpoint string // xxxxxxxx-ats.iot.<region>.amazonaws.com
	Thing    string
	APIBase  string // backend, for presigned bundle URLs
	mtls     *http.Client
	plain    *http.Client
}

func NewIoT(endpoint, thing, apiBase, certFile, keyFile, caFile string) (*IoT, error) {
	cert, err := tls.LoadX509KeyPair(certFile, keyFile)
	if err != nil {
		return nil, fmt.Errorf("load device cert: %w", err)
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read CA: %w", err)
		}
		pool := x509.NewCertPool()
		pool.AppendCertsFromPEM(pem)
		cfg.RootCAs = pool
	}
	return &IoT{
		Endpoint: endpoint, Thing: thing, APIBase: strings.TrimRight(apiBase, "/"),
		mtls:  &http.Client{Timeout: 30 * time.Second, Transport: &http.Transport{TLSClientConfig: cfg}},
		plain: &http.Client{Timeout: 60 * time.Second},
	}, nil
}

func (c *IoT) base() string { return "https://" + c.Endpoint + ":8443" }

func (c *IoT) SendEvent(ctx context.Context, meta EventMeta, bundle []byte) error {
	// 1. presigned URL from the backend
	var pre struct {
		URL string `json:"bundle_upload_url"`
		Key string `json:"bundle_key"`
	}
	b, _ := json.Marshal(map[string]any{"thing": meta.Thing, "vin": meta.VIN, "rule_id": meta.RuleID, "ts": meta.TS})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.APIBase+"/api/device/bundle-url", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	if err := doJSON(c.plain, req, &pre); err != nil {
		return err
	}
	// 2. upload the bundle straight to S3
	put, _ := http.NewRequestWithContext(ctx, http.MethodPut, pre.URL, bytes.NewReader(bundle))
	put.Header.Set("Content-Type", "application/gzip")
	if err := doJSON(c.plain, put, nil); err != nil {
		return err
	}
	// 3. publish the event; an IoT Rule forwards it to EventBridge
	meta.BundleKey = pre.Key
	return c.publish(ctx, "f2f/devices/"+c.Thing+"/events", meta)
}

func (c *IoT) SendHealth(ctx context.Context, h Health) error {
	return c.publish(ctx, "f2f/devices/"+c.Thing+"/health", h)
}

func (c *IoT) publish(ctx context.Context, topic string, v any) error {
	b, _ := json.Marshal(v)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base()+"/topics/"+url.PathEscape(topic)+"?qos=1", bytes.NewReader(b))
	return doJSON(c.mtls, req, nil)
}

func (c *IoT) NextJob(ctx context.Context) (*Job, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+"/things/"+url.PathEscape(c.Thing)+"/jobs/$next", nil)
	var r struct {
		Execution *struct {
			JobID       string      `json:"jobId"`
			JobDocument JobDocument `json:"jobDocument"`
		} `json:"execution"`
	}
	if err := doJSON(c.mtls, req, &r); err != nil {
		return nil, err
	}
	if r.Execution == nil || r.Execution.JobID == "" {
		return nil, ErrNoJob
	}
	return &Job{JobID: r.Execution.JobID, Document: r.Execution.JobDocument}, nil
}

func (c *IoT) UpdateJob(ctx context.Context, jobID, status string, details map[string]string) error {
	b, _ := json.Marshal(map[string]any{"status": status, "statusDetails": details})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base()+"/things/"+url.PathEscape(c.Thing)+"/jobs/"+url.PathEscape(jobID), bytes.NewReader(b))
	return doJSON(c.mtls, req, nil)
}

// Fetch downloads from a presigned S3 URL (no client certificate needed).
func (c *IoT) Fetch(ctx context.Context, u string) ([]byte, error) { return fetch(ctx, c.plain, u) }

func doJSON(c *http.Client, req *http.Request, out any) error {
	resp, err := c.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s %s: %s %s", req.Method, req.URL.Host+req.URL.Path, resp.Status, strings.TrimSpace(string(msg)))
	}
	if out == nil {
		io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
		return nil
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(out)
}

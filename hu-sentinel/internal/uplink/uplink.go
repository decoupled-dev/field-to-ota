// Package uplink sends events and health to the cloud and receives OTA jobs.
package uplink

import (
	"context"
	"errors"
)

// ErrNoJob is returned by NextJob when nothing is queued for this vehicle.
var ErrNoJob = errors.New("no pending job")

type EventMeta struct {
	Thing     string         `json:"thing"`
	VIN       string         `json:"vin"`
	RuleID    string         `json:"rule_id"`
	Severity  string         `json:"severity"`
	SWVersion string         `json:"sw_version"`
	TS        float64        `json:"ts"`
	Metrics   map[string]any `json:"metrics"`
	Summary   string         `json:"summary"`
	BundleKey string         `json:"bundle_key,omitempty"`
}

type JobDocument struct {
	Version     string `json:"version"`
	ArtifactURL string `json:"artifact_url"`
	SHA256      string `json:"sha256"`
	Signature   string `json:"signature"`
	KeyID       string `json:"key_id,omitempty"`
}

type Job struct {
	JobID    string      `json:"job_id"`
	Document JobDocument `json:"document"`
}

type Health struct {
	Thing     string         `json:"thing"`
	VIN       string         `json:"vin"`
	SWVersion string         `json:"sw_version"`
	TS        float64        `json:"ts"`
	Metrics   map[string]any `json:"metrics"`
}

type Uplink interface {
	SendEvent(ctx context.Context, meta EventMeta, bundle []byte) error
	NextJob(ctx context.Context) (*Job, error)
	UpdateJob(ctx context.Context, jobID, status string, details map[string]string) error
	SendHealth(ctx context.Context, h Health) error
	// Fetch downloads an OTA artifact; relative URLs resolve against the backend.
	Fetch(ctx context.Context, url string) ([]byte, error)
}

package main

import (
	"encoding/json"
	"fmt"
	"os"
)

type IoTConfig struct {
	Endpoint string `json:"endpoint"`
	Cert     string `json:"cert"`
	Key      string `json:"key"`
	CA       string `json:"ca"`
}

type Config struct {
	Thing             string    `json:"thing"`
	VIN               string    `json:"vin"`
	Uplink            string    `json:"uplink"` // http | iot
	APIBase           string    `json:"api_base"`
	IoT               IoTConfig `json:"iot"`
	LogPath           string    `json:"log_path"`
	FromStart         bool      `json:"from_start"`
	RulesPath         string    `json:"rules_path"`
	ServicePath       string    `json:"service_path"`
	OTAPubKeyPath     string    `json:"ota_pubkey_path"`
	SpoolDir          string    `json:"spool_dir"`
	SpoolMaxMB        int       `json:"spool_max_mb"`
	PollIntervalS     float64   `json:"poll_interval_s"`
	MaxUploadsPerHour int       `json:"max_uploads_per_hour"`
	RingLines         int       `json:"ring_lines"`
	RingSeconds       float64   `json:"ring_seconds"`
	AudioPath         string    `json:"audio_path"`
	ScreenPath        string    `json:"screen_path"`
	TombstonePath     string    `json:"tombstone_path"`
}

func defaults() Config {
	return Config{
		Uplink: "http", APIBase: "http://127.0.0.1:8000", LogPath: ".hu/logcat.log",
		RulesPath: "hu-sentinel/rules.json", ServicePath: ".hu/system/media-service",
		OTAPubKeyPath: ".keys/ota_signing.pub", SpoolDir: ".hu/spool", SpoolMaxMB: 64,
		PollIntervalS: 5, MaxUploadsPerHour: 12, RingLines: 4000, RingSeconds: 60,
	}
}

func loadConfig(path string) (Config, error) {
	c := defaults()
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return c, err
		}
		if err := json.Unmarshal(b, &c); err != nil {
			return c, fmt.Errorf("parse %s: %w", path, err)
		}
	}
	if c.Thing == "" || c.VIN == "" {
		return c, fmt.Errorf("config: thing and vin are required")
	}
	if c.Uplink != "http" && c.Uplink != "iot" {
		return c, fmt.Errorf("config: uplink must be http or iot")
	}
	return c, nil
}

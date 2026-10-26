// hu-sentinel is a lightweight head-unit health daemon. It watches the log stream against
// rules, captures BugReport-style bundles when a rule fires, ships them to the cloud and
// applies signed OTA updates that close the loop.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/field-to-fix/hu-sentinel/internal/capture"
	"github.com/field-to-fix/hu-sentinel/internal/collector"
	"github.com/field-to-fix/hu-sentinel/internal/health"
	"github.com/field-to-fix/hu-sentinel/internal/limiter"
	"github.com/field-to-fix/hu-sentinel/internal/ota"
	"github.com/field-to-fix/hu-sentinel/internal/queue"
	"github.com/field-to-fix/hu-sentinel/internal/ringbuf"
	"github.com/field-to-fix/hu-sentinel/internal/rules"
	"github.com/field-to-fix/hu-sentinel/internal/uplink"
)

var version = "0.3.0"

func main() {
	cfgPath := flag.String("config", "hu-sentinel.json", "path to config file")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println("hu-sentinel", version)
		return
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if err := run(*cfgPath, log); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

type daemon struct {
	cfg     Config
	log     *slog.Logger
	up      uplink.Uplink
	engine  *rules.Engine
	ring    *ringbuf.Ring
	spool   *queue.Spool
	limit   *limiter.Hourly
	proc    *collector.Proc
	health  health.Tracker
	updater *ota.Updater
}

func run(cfgPath string, log *slog.Logger) error {
	cfg, err := loadConfig(cfgPath)
	if err != nil {
		return err
	}
	// Telemetry must never compete with the HMI for CPU.
	_ = syscall.Setpriority(syscall.PRIO_PROCESS, 0, 10)

	d := &daemon{cfg: cfg, log: log.With("thing", cfg.Thing), proc: &collector.Proc{},
		limit: limiter.NewHourly(cfg.MaxUploadsPerHour),
		ring:  ringbuf.New(cfg.RingLines, time.Duration(cfg.RingSeconds*float64(time.Second)))}
	if d.engine, err = rules.Load(cfg.RulesPath); err != nil {
		return fmt.Errorf("rules: %w", err)
	}
	if d.spool, err = queue.New(cfg.SpoolDir, int64(cfg.SpoolMaxMB)<<20); err != nil {
		return fmt.Errorf("spool: %w", err)
	}
	switch cfg.Uplink {
	case "iot":
		d.up, err = uplink.NewIoT(cfg.IoT.Endpoint, cfg.Thing, cfg.APIBase, cfg.IoT.Cert, cfg.IoT.Key, cfg.IoT.CA)
		if err != nil {
			return err
		}
	default:
		d.up = uplink.NewHTTP(cfg.APIBase, cfg.Thing)
	}
	d.updater = &ota.Updater{Up: d.up, PubKeyPath: cfg.OTAPubKeyPath, ServicePath: cfg.ServicePath, Log: d.log}

	ids := make([]string, 0, len(d.engine.Rules()))
	for _, r := range d.engine.Rules() {
		ids = append(ids, r.ID)
	}
	d.log.Info("hu-sentinel started", "version", version, "vin", cfg.VIN, "uplink", cfg.Uplink,
		"sw", d.swVersion(), "rules", strings.Join(ids, ","), "log", cfg.LogPath)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	lines := make(chan string, 1024)
	go collector.Tail(ctx, cfg.LogPath, cfg.FromStart, lines, d.log)
	go d.every(ctx, 5*time.Second, d.proc.Sample)
	go d.every(ctx, time.Duration(cfg.PollIntervalS*float64(time.Second)), func() { d.pollOTA(ctx) })
	go d.drainLoop(ctx)

	for line := range lines {
		now := time.Now()
		d.ring.Add(now, line)
		if r := d.health.Feed(line); r != nil {
			go d.reportHealth(ctx, r)
		}
		for _, tr := range d.engine.Feed(now, line) {
			d.onTrigger(ctx, tr)
		}
	}
	d.log.Info("shutting down")
	return nil
}

func (d *daemon) every(ctx context.Context, interval time.Duration, fn func()) {
	t := time.NewTicker(interval)
	defer t.Stop()
	fn()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			fn()
		}
	}
}

func (d *daemon) swVersion() string {
	b, err := os.ReadFile(filepath.Join(d.cfg.ServicePath, "VERSION"))
	if err != nil {
		return "unknown"
	}
	v := strings.TrimSpace(string(b))
	if !strings.HasPrefix(v, "HU-") {
		v = "HU-" + v
	}
	return v
}

func (d *daemon) onTrigger(ctx context.Context, tr rules.Trigger) {
	r := tr.Rule
	log := d.log.With("rule", r.ID, "severity", r.Severity)
	log.Warn("rule fired", "summary", tr.Summary)
	if !d.limit.Allow(tr.At) {
		log.Warn("upload suppressed: hourly cap reached", "cap", d.cfg.MaxUploadsPerHour)
		return
	}
	// Let the incident finish so the bundle includes the lines right after the trigger.
	time.AfterFunc(2*time.Second, func() { d.captureAndSend(ctx, tr) })
}

func (d *daemon) captureAndSend(ctx context.Context, tr rules.Trigger) {
	r := tr.Rule
	snap := d.proc.Snapshot()
	sw := d.swVersion()
	device := map[string]any{"thing": d.cfg.Thing, "vin": d.cfg.VIN, "sw_version": sw, "sentinel_version": version}
	bundle, man, err := capture.Build(capture.Request{
		RuleID: r.ID, Capture: r.Capture, Logs: d.ring.Snapshot(time.Now()),
		Rule:   map[string]any{"id": r.ID, "description": r.Description, "severity": r.Severity, "counts": tr.Counts, "summary": tr.Summary},
		Device: device, Proc: snap, Audio: d.cfg.AudioPath, Screen: d.cfg.ScreenPath, Tombstone: d.cfg.TombstonePath,
	}, time.Now())
	if err != nil {
		d.log.Error("bundle build failed", "rule", r.ID, "err", err)
		return
	}
	metrics := map[string]any{"match_count": tr.Counts[r.Condition.ID], "window_s": r.Condition.WindowS,
		"cpu": snap.CPUPercent, "mem_mb": snap.MemUsedMB, "bundle_bytes": len(bundle), "files": man.Files}
	for id, n := range tr.Counts {
		if id != r.Condition.ID {
			metrics[strings.ToLower(id)+"_count"] = n
		}
	}
	meta := uplink.EventMeta{Thing: d.cfg.Thing, VIN: d.cfg.VIN, RuleID: r.ID, Severity: r.Severity,
		SWVersion: sw, TS: float64(tr.At.UnixMilli()) / 1000, Metrics: metrics, Summary: tr.Summary}
	if err := d.up.SendEvent(ctx, meta, bundle); err != nil {
		d.log.Warn("uplink failed, spooling bundle", "rule", r.ID, "err", err)
		if err := d.spool.Put(meta, bundle); err != nil {
			d.log.Error("spool failed", "err", err)
		}
		return
	}
	d.log.Info("bug report uploaded", "rule", r.ID, "bytes", len(bundle), "files", len(man.Files))
}

func (d *daemon) drainLoop(ctx context.Context) {
	backoff := 5 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff):
		}
		if d.spool.Len() == 0 {
			backoff = 5 * time.Second
			continue
		}
		n, err := d.spool.Drain(func(m uplink.EventMeta, b []byte) error { return d.up.SendEvent(ctx, m, b) })
		if n > 0 {
			d.log.Info("spooled bundles delivered", "count", n)
		}
		if err != nil {
			backoff = min(backoff*2, 5*time.Minute)
			d.log.Debug("spool drain deferred", "retry_in", backoff, "err", err)
		} else {
			backoff = 5 * time.Second
		}
	}
}

func (d *daemon) reportHealth(ctx context.Context, r *health.BootReport) {
	snap := d.proc.Snapshot()
	m := map[string]any{"underruns": r.Underruns, "a2dp_reconnects": r.Reconnects, "cpu": snap.CPUPercent,
		"mem_mb": snap.MemUsedMB, "daemon_rss_kb": snap.DaemonRSSKB}
	if r.AmbientC != nil {
		m["ambient_c"] = *r.AmbientC
	}
	// Attribute the boot to the build that actually ran it: an OTA can land mid-boot.
	sw := r.SWVersion
	if sw == "" {
		sw = d.swVersion()
	}
	h := uplink.Health{Thing: d.cfg.Thing, VIN: d.cfg.VIN, SWVersion: sw,
		TS: float64(time.Now().UnixMilli()) / 1000, Metrics: m}
	if err := d.up.SendHealth(ctx, h); err != nil {
		d.log.Warn("health report failed", "err", err)
		return
	}
	d.log.Info("boot health reported", "sw", h.SWVersion, "underruns", r.Underruns, "reconnects", r.Reconnects)
}

func (d *daemon) pollOTA(ctx context.Context) {
	job, err := d.up.NextJob(ctx)
	if errors.Is(err, uplink.ErrNoJob) {
		return
	}
	if err != nil {
		d.log.Debug("job poll failed", "err", err)
		return
	}
	if v, err := d.updater.Apply(ctx, job); err == nil {
		d.log.Info("now running", "sw", "HU-"+strings.TrimPrefix(v, "HU-"))
	}
}

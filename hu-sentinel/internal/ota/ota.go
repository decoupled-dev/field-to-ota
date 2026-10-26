// Package ota applies signed OTA jobs: download, verify, extract, atomic swap, report.
package ota

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/field-to-fix/hu-sentinel/internal/uplink"
)

const maxExtract = 512 << 20

// LoadPublicKey reads a base64-encoded raw 32-byte ed25519 public key.
func LoadPublicKey(path string) (ed25519.PublicKey, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b)))
	if err != nil {
		return nil, fmt.Errorf("decode public key: %w", err)
	}
	if len(raw) != ed25519.PublicKeySize {
		return nil, fmt.Errorf("public key must be %d bytes, got %d", ed25519.PublicKeySize, len(raw))
	}
	return ed25519.PublicKey(raw), nil
}

// Verify checks the artifact digest and the ed25519 signature over the raw artifact bytes.
func Verify(artifact []byte, sha256Hex, sigB64 string, pub ed25519.PublicKey) error {
	sum := sha256.Sum256(artifact)
	if !strings.EqualFold(hex.EncodeToString(sum[:]), sha256Hex) {
		return errors.New("sha256 mismatch")
	}
	sig, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		return fmt.Errorf("decode signature: %w", err)
	}
	if !ed25519.Verify(pub, artifact, sig) {
		return errors.New("signature verification failed")
	}
	return nil
}

type Updater struct {
	Up          uplink.Uplink
	PubKeyPath  string
	ServicePath string
	Log         *slog.Logger
}

// Apply runs one job end to end and reports its status. It returns the installed version.
func (u *Updater) Apply(ctx context.Context, job *uplink.Job) (string, error) {
	doc := job.Document
	log := u.Log.With("job", job.JobID, "version", doc.Version)
	log.Info("ota job received")
	u.Up.UpdateJob(ctx, job.JobID, "IN_PROGRESS", map[string]string{"step": "downloading"})

	fail := func(step string, err error) (string, error) {
		log.Error("ota failed", "step", step, "err", err)
		u.Up.UpdateJob(ctx, job.JobID, "FAILED", map[string]string{"step": step, "reason": err.Error()})
		return "", err
	}
	pub, err := LoadPublicKey(u.PubKeyPath)
	if err != nil {
		return fail("load_key", err)
	}
	art, err := u.Up.Fetch(ctx, doc.ArtifactURL)
	if err != nil {
		return fail("download", err)
	}
	if err := Verify(art, doc.SHA256, doc.Signature, pub); err != nil {
		return fail("verify", err)
	}
	log.Info("artifact verified", "bytes", len(art), "sha256", doc.SHA256[:12])
	u.Up.UpdateJob(ctx, job.JobID, "IN_PROGRESS", map[string]string{"step": "installing"})
	if err := Install(art, u.ServicePath, doc.Version); err != nil {
		return fail("install", err)
	}
	log.Info("ota installed", "path", u.ServicePath)
	u.Up.UpdateJob(ctx, job.JobID, "SUCCEEDED", map[string]string{
		"version": doc.Version, "sha256": doc.SHA256, "installed_at": time.Now().UTC().Format(time.RFC3339)})
	return doc.Version, nil
}

// Install extracts a tar.gz next to dest and swaps it in atomically, keeping dest.bak for rollback.
func Install(artifact []byte, dest, version string) error {
	dest = filepath.Clean(dest)
	parent := filepath.Dir(dest)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(parent, "."+filepath.Base(dest)+".new-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging) // no-op after a successful rename
	if err := extract(artifact, staging); err != nil {
		return err
	}
	if version != "" {
		vf := filepath.Join(staging, "VERSION")
		if _, err := os.Stat(vf); errors.Is(err, os.ErrNotExist) {
			os.WriteFile(vf, []byte(version+"\n"), 0o644)
		}
	}
	bak := dest + ".bak"
	os.RemoveAll(bak)
	hadOld := false
	if _, err := os.Stat(dest); err == nil {
		if err := os.Rename(dest, bak); err != nil {
			return err
		}
		hadOld = true
	}
	if err := os.Rename(staging, dest); err != nil {
		if hadOld {
			os.Rename(bak, dest) // roll back
		}
		return err
	}
	return nil
}

func extract(artifact []byte, dir string) error {
	gz, err := gzip.NewReader(bytes.NewReader(artifact))
	if err != nil {
		return fmt.Errorf("artifact is not gzip: %w", err)
	}
	tr := tar.NewReader(gz)
	var total int64
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(strings.TrimPrefix(h.Name, "./"))
		if name == "." {
			continue
		}
		if filepath.IsAbs(name) || name == ".." || strings.HasPrefix(name, "../") {
			return fmt.Errorf("unsafe path in artifact: %q", h.Name)
		}
		target := filepath.Join(dir, name)
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			total += h.Size
			if total > maxExtract {
				return errors.New("artifact too large when extracted")
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(h.Mode)&0o755|0o600)
			if err != nil {
				return err
			}
			_, err = io.Copy(f, io.LimitReader(tr, h.Size))
			f.Close()
			if err != nil {
				return err
			}
		default:
			return fmt.Errorf("unsupported entry %q (type %c): links are rejected", h.Name, h.Typeflag)
		}
	}
}

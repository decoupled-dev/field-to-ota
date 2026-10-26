package ota

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func artifact(t *testing.T, files map[string]string) []byte {
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, body := range files {
		tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		tw.Write([]byte(body))
	}
	tw.Close()
	gz.Close()
	return buf.Bytes()
}

func sign(t *testing.T, art []byte) (ed25519.PublicKey, string, string) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(art)
	return pub, hex.EncodeToString(sum[:]), base64.StdEncoding.EncodeToString(ed25519.Sign(priv, art))
}

func TestVerifyAcceptsValidSignature(t *testing.T) {
	art := artifact(t, map[string]string{"VERSION": "2.3.2\n"})
	pub, sum, sig := sign(t, art)
	if err := Verify(art, sum, sig, pub); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyRejectsTamperedArtifact(t *testing.T) {
	art := artifact(t, map[string]string{"VERSION": "2.3.2\n"})
	pub, _, sig := sign(t, art)
	tampered := append([]byte{}, art...)
	tampered[len(tampered)-1] ^= 0xff
	sum := sha256.Sum256(tampered)
	if err := Verify(tampered, hex.EncodeToString(sum[:]), sig, pub); err == nil {
		t.Fatal("tampered artifact must fail signature check")
	}
}

func TestVerifyRejectsWrongKey(t *testing.T) {
	art := artifact(t, map[string]string{"VERSION": "2.3.2\n"})
	_, sum, sig := sign(t, art)
	other, _, _ := ed25519.GenerateKey(rand.Reader)
	if err := Verify(art, sum, sig, other); err == nil {
		t.Fatal("signature from another key must fail")
	}
}

func TestInstallSwapsAtomically(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "media-service")
	os.MkdirAll(dest, 0o755)
	os.WriteFile(filepath.Join(dest, "VERSION"), []byte("2.3.1\n"), 0o644)
	art := artifact(t, map[string]string{"VERSION": "2.3.2\n", "media_service/config.py": "X = 1\n"})
	if err := Install(art, dest, "2.3.2"); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dest, "VERSION")); string(b) != "2.3.2\n" {
		t.Fatalf("VERSION = %q", b)
	}
	if b, _ := os.ReadFile(filepath.Join(dest+".bak", "VERSION")); string(b) != "2.3.1\n" {
		t.Fatalf("backup VERSION = %q", b)
	}
}

func TestInstallRejectsPathTraversal(t *testing.T) {
	dest := filepath.Join(t.TempDir(), "svc")
	art := artifact(t, map[string]string{"../evil": "x"})
	if err := Install(art, dest, ""); err == nil {
		t.Fatal("path traversal must be rejected")
	}
}

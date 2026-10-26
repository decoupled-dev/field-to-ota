package collector

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestTailFollowsAppendsAndTruncation(t *testing.T) {
	p := filepath.Join(t.TempDir(), "logcat.log")
	os.WriteFile(p, []byte("before start\n"), 0o644)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ch := make(chan string, 10)
	go Tail(ctx, p, false, ch, slog.New(slog.NewTextHandler(io.Discard, nil)))
	time.Sleep(300 * time.Millisecond)

	f, _ := os.OpenFile(p, os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString("line one\n")
	f.Close()
	if got := <-ch; got != "line one" {
		t.Fatalf("got %q", got)
	}
	os.WriteFile(p, []byte("after truncate\n"), 0o644) // truncation, like a rotated logcat file
	if got := <-ch; got != "after truncate" {
		t.Fatalf("got %q", got)
	}
}

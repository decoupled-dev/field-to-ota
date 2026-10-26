// Package collector reads the log stream and samples system health.
package collector

import (
	"bufio"
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"
)

const maxLine = 4096

// Tail follows a file like `tail -F`: it survives truncation and rotation and waits for the file to appear.
// When fromStart is false, it begins at the current end of the file (live stream semantics, like logcat).
func Tail(ctx context.Context, path string, fromStart bool, out chan<- string, log *slog.Logger) {
	defer close(out)
	first := true
	for ctx.Err() == nil {
		f, err := os.Open(path)
		if err != nil {
			if !sleep(ctx, time.Second) {
				return
			}
			first = false // a file created later is read from its start
			continue
		}
		if first && !fromStart {
			if _, err := f.Seek(0, io.SeekEnd); err != nil {
				log.Warn("seek failed", "err", err)
			}
		}
		first = false
		log.Info("tailing log", "path", path)
		follow(ctx, f, path, out)
		f.Close()
	}
}

func follow(ctx context.Context, f *os.File, path string, out chan<- string) {
	r := bufio.NewReaderSize(f, 64*1024)
	var partial strings.Builder
	for {
		chunk, err := r.ReadString('\n')
		if len(chunk) > 0 && partial.Len() < maxLine {
			partial.WriteString(chunk)
		}
		if err == nil {
			line := strings.TrimRight(partial.String(), "\r\n")
			partial.Reset()
			if len(line) > maxLine {
				line = line[:maxLine]
			}
			select {
			case out <- line:
			case <-ctx.Done():
				return
			}
			continue
		}
		if err != io.EOF {
			return
		}
		if !sleep(ctx, 200*time.Millisecond) {
			return
		}
		if rotated(f, path) {
			return
		}
	}
}

func rotated(f *os.File, path string) bool {
	cur, err := f.Stat()
	if err != nil {
		return true
	}
	disk, err := os.Stat(path)
	if err != nil || !os.SameFile(cur, disk) {
		return true
	}
	pos, err := f.Seek(0, io.SeekCurrent)
	return err != nil || disk.Size() < pos // truncated
}

func sleep(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

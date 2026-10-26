package collector

import (
	"bufio"
	"os"
	"strconv"
	"strings"
	"sync"
)

// Proc samples CPU and memory from /proc. Every method degrades to zero values off Linux.
type Proc struct {
	mu              sync.Mutex
	lastIdle, lastT uint64
	cpu             float64
}

type Snapshot struct {
	CPUPercent  float64 `json:"cpu"`
	MemUsedMB   float64 `json:"mem_mb"`
	MemTotalMB  float64 `json:"mem_total_mb"`
	DaemonRSSKB int     `json:"daemon_rss_kb"`
	LoadAvg     string  `json:"loadavg"`
}

// Sample updates the CPU estimate from the delta since the previous call.
func (p *Proc) Sample() {
	idle, total := readStat()
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.lastT != 0 && total > p.lastT {
		dt, di := float64(total-p.lastT), float64(idle-p.lastIdle)
		p.cpu = 100 * (1 - di/dt)
	}
	p.lastIdle, p.lastT = idle, total
}

func (p *Proc) Snapshot() Snapshot {
	p.mu.Lock()
	cpu := p.cpu
	p.mu.Unlock()
	mi := readKV("/proc/meminfo")
	total := float64(mi["MemTotal"]) / 1024
	avail := float64(mi["MemAvailable"]) / 1024
	la, _ := os.ReadFile("/proc/loadavg")
	return Snapshot{
		CPUPercent:  round1(cpu),
		MemUsedMB:   round1(total - avail),
		MemTotalMB:  round1(total),
		DaemonRSSKB: readKV("/proc/self/status")["VmRSS"],
		LoadAvg:     strings.TrimSpace(string(la)),
	}
}

func readStat() (idle, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	if !s.Scan() {
		return 0, 0
	}
	fields := strings.Fields(s.Text())
	for i, v := range fields[1:] {
		n, _ := strconv.ParseUint(v, 10, 64)
		total += n
		if i == 3 || i == 4 { // idle + iowait
			idle += n
		}
	}
	return idle, total
}

// readKV parses "Key:   1234 kB" style files.
func readKV(path string) map[string]int {
	out := map[string]int{}
	f, err := os.Open(path)
	if err != nil {
		return out
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		k, v, ok := strings.Cut(s.Text(), ":")
		if !ok {
			continue
		}
		fs := strings.Fields(v)
		if len(fs) == 0 {
			continue
		}
		if n, err := strconv.Atoi(fs[0]); err == nil {
			out[k] = n
		}
	}
	return out
}

func round1(f float64) float64 { return float64(int(f*10+0.5)) / 10 }

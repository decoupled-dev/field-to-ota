import type { StageDef, StageRun } from "@/lib/api";
import { STATUS_LABEL, STATUS_TEXT } from "@/components/domain";
import { cn, fmtClock, fmtDuration } from "@/lib/utils";

/** Where the time went: one row per stage, bar length = stage duration.
 *  The human gate is drawn hatched and excluded from the scale so it doesn't flatten the agent stages. */
export function TimelineView({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  const now = Date.now() / 1000;
  const dur = (r?: StageRun) => (r?.started_at ? Math.max(0, (r.ended_at ?? now) - r.started_at) : 0);
  const t0 = Math.min(...stages.map((s) => runs[s.key]?.started_at ?? Infinity));
  const scale = Math.max(1, ...stages.filter((s) => s.v_side !== "gate").map((s) => dur(runs[s.key])));
  const agentTotal = stages.filter((s) => s.v_side !== "gate").reduce((a, s) => a + dur(runs[s.key]), 0);
  const gateTotal = stages.filter((s) => s.v_side === "gate").reduce((a, s) => a + dur(runs[s.key]), 0);

  return (
    <div className="px-2 py-3">
      <div className="mb-3 grid grid-cols-[200px_1fr_90px] items-center gap-4 px-3">
        <span className="label">Stage</span>
        <span className="label">Duration (agent stages to scale)</span>
        <span className="label text-right">T+ start</span>
      </div>
      <ul className="space-y-0.5">
        {stages.map((s, i) => {
          const r = runs[s.key];
          const st = r?.status ?? "pending";
          const gate = s.v_side === "gate";
          const d = dur(r);
          const pct = gate ? (d ? 100 : 0) : Math.max(d ? 1.5 : 0, (d / scale) * 100);
          return (
            <li key={s.key}>
              <button
                type="button"
                onClick={() => onSelect(s.key)}
                className={cn("grid w-full grid-cols-[200px_1fr_90px] items-center gap-4 rounded-sm px-3 py-1.5 text-left transition-colors", selected === s.key ? "bg-raised shadow-[inset_2px_0_0_hsl(var(--fg))]" : "hover:bg-subtle/60")}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="tnum font-mono text-2xs text-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className={cn("truncate text-[12.5px] font-medium", st === "pending" ? "text-muted" : "text-fg")}>{s.name}</span>
                </span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="relative h-3.5 flex-1 rounded-[1px] bg-subtle/70">
                    {d > 0 && (
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-[1px]",
                          gate ? "hatch text-warn/70" : st === "running" ? "bg-run" : st === "failed" ? "bg-bad" : "bg-ok/80",
                          st === "running" && "animate-pulseSoft",
                        )}
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    )}
                  </span>
                  <span className={cn("tnum w-[92px] shrink-0 font-mono text-2xs uppercase", STATUS_TEXT[st])}>
                    {d ? fmtDuration(r!.started_at, r!.ended_at) : STATUS_LABEL[st]}
                    {gate && d > 0 && <span className="text-faint"> wait</span>}
                  </span>
                </span>
                <span className="tnum text-right font-mono text-2xs text-faint">{r?.started_at && isFinite(t0) ? `+${fmtDuration(t0, r.started_at) || "0s"}` : "—"}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 border-t border-border px-3 pt-3 font-mono text-2xs uppercase tracking-[0.06em] text-muted">
        <span>Agent time <span className="tnum ml-1 text-fg">{fmtDuration(now - agentTotal, now) || "0s"}</span></span>
        <span>Human gate <span className="tnum ml-1 text-warn">{gateTotal ? fmtDuration(now - gateTotal, now) : "—"}</span></span>
        {isFinite(t0) && <span>Started <span className="tnum ml-1 text-fg">{fmtClock(t0)}</span></span>}
      </div>
    </div>
  );
}

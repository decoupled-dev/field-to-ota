import type { StageDef, StageRun, StageStatus } from "@/lib/api";
import { STATUS_LABEL, STATUS_TEXT, StatusIcon } from "@/components/domain";
import { cn, fmtDuration } from "@/lib/utils";

// Phases mirror the Step Functions groups in infra/app.py.
const PHASES: { title: string; keys: string[] }[] = [
  { title: "Intake", keys: ["detect", "triage", "ticket"] },
  { title: "Diagnose", keys: ["fleet", "reproduce", "rca"] },
  { title: "Engineer", keys: ["requirement", "fix", "verify"] },
  { title: "Release", keys: ["approve", "release", "monitor"] },
];

const BAR: Record<StageStatus, string> = {
  pending: "bg-border",
  skipped: "bg-border",
  running: "bg-run",
  passed: "bg-ok",
  awaiting_approval: "bg-warn",
  failed: "bg-bad",
};

/** The pipeline as a 12-cell tape grouped into phases. Always visible above the schematic. */
export function StageTape({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  const known = new Set(PHASES.flatMap((p) => p.keys));
  const groups = [
    ...PHASES.map((p) => ({ title: p.title, items: stages.filter((s) => p.keys.includes(s.key)) })),
    { title: "Other", items: stages.filter((s) => !known.has(s.key)) },
  ].filter((g) => g.items.length);
  const index = (k: string) => stages.findIndex((s) => s.key === k);

  return (
    <div className="panel flex overflow-x-auto">
      {groups.map((g, gi) => {
        const done = g.items.filter((s) => runs[s.key]?.status === "passed").length;
        return (
          <div key={g.title} className={cn("min-w-[240px] flex-1", gi > 0 && "border-l border-strong/60")}>
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="label text-fg">{g.title}</span>
              <span className="tnum font-mono text-2xs text-faint">{done}/{g.items.length}</span>
            </div>
            <div className="flex">
              {g.items.map((s, i) => {
                const run = runs[s.key];
                const st = run?.status ?? "pending";
                const sel = selected === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onSelect(s.key)}
                    className={cn(
                      "group relative min-w-0 flex-1 px-2.5 pb-2.5 pt-3 text-left transition-colors",
                      i > 0 && "border-l border-border",
                      sel ? "bg-raised" : "hover:bg-subtle/60",
                    )}
                  >
                    <span className={cn("absolute inset-x-0 top-0 h-[3px] overflow-hidden", BAR[st], st === "pending" && "opacity-70")}>
                      {st === "running" && <span className="absolute inset-0 animate-sweep bg-gradient-to-r from-transparent via-white/60 to-transparent" />}
                    </span>
                    {sel && <span className="absolute inset-x-0 bottom-0 h-px bg-fg" />}
                    <span title={s.name} className={cn("block truncate text-[12.5px] font-semibold tracking-tight", st === "pending" ? "text-muted" : "text-fg")}>{s.name}</span>
                    <span className="mt-1 flex items-center gap-1.5 font-mono text-2xs">
                      <span className="tnum text-faint">{String(index(s.key) + 1).padStart(2, "0")}</span>
                      <StatusIcon status={st} size={10} />
                      <span className={cn("tnum truncate", STATUS_TEXT[st])}>
                        {run?.started_at && st !== "pending" ? fmtDuration(run.started_at, run.ended_at) : st === "pending" ? "—" : STATUS_LABEL[st]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

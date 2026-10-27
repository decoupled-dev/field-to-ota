import type { StageDef, StageRun, StageStatus } from "@/lib/api";
import { STATUS_LABEL, StatusIcon } from "@/components/domain";
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

/** The pipeline as one cell per phase: progress segments per stage, plus the stage that needs attention. */
export function StageTape({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  const known = new Set(PHASES.flatMap((p) => p.keys));
  const groups = [
    ...PHASES.map((p) => ({ title: p.title, items: stages.filter((s) => p.keys.includes(s.key)) })),
    { title: "Other", items: stages.filter((s) => !known.has(s.key)) },
  ].filter((g) => g.items.length);

  return (
    <div className="panel grid overflow-hidden sm:grid-cols-2 lg:grid-flow-col lg:auto-cols-fr lg:grid-cols-none">
      {groups.map((g, gi) => {
        const done = g.items.filter((s) => runs[s.key]?.status === "passed").length;
        // Headline: the first stage that isn't finished, else the last one.
        const focus = g.items.find((s) => runs[s.key]?.status !== "passed") ?? g.items[g.items.length - 1];
        const fst = runs[focus.key]?.status ?? "pending";
        return (
          <div key={g.title} className={cn("min-w-0 px-4 py-3", gi > 0 && "border-t border-border lg:border-l lg:border-t-0")}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{g.title}</span>
              <span className="tnum text-xs text-faint">{done}/{g.items.length}</span>
            </div>
            <div className="mt-2 flex gap-1">
              {g.items.map((s) => {
                const run = runs[s.key];
                const st = run?.status ?? "pending";
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onSelect(s.key)}
                    title={`${s.name} · ${run?.started_at && st !== "pending" ? fmtDuration(run.started_at, run.ended_at) : STATUS_LABEL[st]}`}
                    aria-label={s.name}
                    className={cn("h-1.5 flex-1 rounded-full transition-[box-shadow]", BAR[st], selected === s.key ? "ring-2 ring-accent ring-offset-1 ring-offset-surface" : "hover:opacity-80")}
                  />
                );
              })}
            </div>
            <button type="button" onClick={() => onSelect(focus.key)} className="mt-2 flex max-w-full items-center gap-1.5 text-left text-[13px] hover:text-accent">
              <StatusIcon status={fst} size={11} />
              <span className={cn("truncate", fst === "pending" ? "text-faint" : "text-fg")}>{done === g.items.length ? "Complete" : focus.name}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

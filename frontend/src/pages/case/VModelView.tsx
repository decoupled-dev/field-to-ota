import { useEffect, useRef, useState } from "react";
import type { StageDef, StageRun } from "@/lib/api";
import { STATUS_LABEL } from "@/components/domain";
import { cn } from "@/lib/utils";
import { StageCard } from "./PipelineGraph";

// Canvas coordinates (card centers). The V runs from Requirements (top-left) down to
// Implementation (bottom) and back up to Vehicle release (top-right). Field stages sit
// above the V: the loop starts and ends in the field.
const CW = 1340;
const CH = 580;
const CARD_W = 168;
const ROW = { field: 70, d1: 178, d2: 288, d3: 398, d4: 500 };

const POS: Record<string, [number, number]> = {
  monitor: [520, ROW.field],
  detect: [700, ROW.field],
  triage: [880, ROW.field],
  ticket: [1060, ROW.field],
  fleet: [1120, ROW.d1],
  reproduce: [1010, ROW.d2],
  rca: [330, ROW.d2],
  requirement: [200, ROW.d1],
  fix: [600, ROW.d4],
  verify: [720, ROW.d3],
  approve: [868, 330],
  release: [930, ROW.d1],
};

const V_PATH = `M ${200} ${ROW.d1} L ${600} ${ROW.d4} L ${930} ${ROW.d1}`;

const LEVELS: { y: number; left: string; right: string }[] = [
  { y: ROW.field, left: "", right: "" },
  { y: ROW.d1, left: "Requirements", right: "Vehicle validation" },
  { y: ROW.d2, left: "Architecture & design", right: "System integration" },
  { y: ROW.d3, left: "Detailed design", right: "Unit & integration test" },
  { y: ROW.d4, left: "Implementation", right: "" },
];

function edgeColor(a?: StageRun, b?: StageRun) {
  if (a?.status === "passed" && (b?.status === "running" || b?.status === "awaiting_approval")) return "hsl(var(--run))";
  if (a?.status === "passed" && b && b.status !== "pending") return "hsl(var(--ok))";
  return "hsl(var(--muted) / 0.45)";
}

export function VModelView({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  // Unknown (future) stages get a fallback slot along the bottom so the view stays extensible.
  let extra = 0;
  const pos = (k: string): [number, number] => POS[k] ?? [90 + extra++ * 170, CH - 30];
  const placed = stages.map((s) => ({ s, p: pos(s.key) }));

  // Scale the fixed canvas down to the available width so nothing is clipped.
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(Math.min(1, e.contentRect.width / CW)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} className="w-full" style={{ height: CH * scale }}>
      <div className="relative origin-top-left" style={{ width: CW, height: CH, transform: `scale(${scale})` }}>
        <svg width={CW} height={CH} className="absolute inset-0">
          <defs>
            <marker id="vm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
            </marker>
          </defs>
          {/* field band */}
          <rect x={420} y={ROW.field - 38} width={744} height={76} rx={8} fill="hsl(var(--subtle) / 0.6)" stroke="hsl(var(--border))" strokeDasharray="4 4" />
          <text x={430} y={ROW.field - 46} className="fill-muted" fontSize={11} fontWeight={500} letterSpacing={0.8}>FIELD</text>
          {/* the V */}
          <path d={V_PATH} fill="none" stroke="hsl(var(--subtle))" strokeWidth={46} strokeLinejoin="round" strokeLinecap="round" />
          <path d={V_PATH} fill="none" stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray="2 4" />
          {LEVELS.map((l) => (
            <g key={l.y}>
              {l.left && <text x={16} y={l.y + 4} fontSize={11} className="fill-muted">{l.left}</text>}
              {l.right && <text x={CW - 16} y={l.y + 4} fontSize={11} textAnchor="end" className="fill-muted">{l.right}</text>}
              {l.left && <line x1={16} x2={120} y1={l.y + 12} y2={l.y + 12} stroke="hsl(var(--border))" />}
            </g>
          ))}
          <text x={600} y={ROW.d4 + 62} fontSize={11} textAnchor="middle" className="fill-muted">Left side: specify & build · Right side: verify & validate</text>
          {/* flow */}
          {placed.slice(1).map(({ s, p }, i) => {
            const prev = placed[i];
            const [x1, y1] = prev.p;
            const [x2, y2] = p;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            // trim to card edges (approximate as ellipse around the card)
            const trim = (ux: number, uy: number) => {
              const tx = Math.abs(ux) > 1e-6 ? (CARD_W / 2 + 6) / Math.abs(ux) : Infinity;
              const ty = Math.abs(uy) > 1e-6 ? 36 / Math.abs(uy) : Infinity;
              return Math.min(tx, ty);
            };
            const ux = dx / len;
            const uy = dy / len;
            const t = trim(ux, uy);
            const sx = x1 + ux * t;
            const sy = y1 + uy * t;
            const ex = x2 - ux * t;
            const ey = y2 - uy * t;
            const stroke = edgeColor(runs[prev.s.key], runs[s.key]);
            const cross = s.key === "rca";
            const outer = prev.s.key === "requirement" && s.key === "fix";
            const d = cross
              ? `M ${sx} ${sy} C ${sx - 160} ${sy - 110}, ${ex + 160} ${ey - 110}, ${ex} ${ey}`
              : outer
                ? `M ${x1 - 40} ${y1 + 30} L ${x1 - 40} ${y2} L ${x2 - CARD_W / 2 - 6} ${y2}`
                : `M ${sx} ${sy} L ${ex} ${ey}`;
            return (
              <g key={s.key}>
                <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} markerEnd="url(#vm-arrow)" strokeDasharray={runs[s.key]?.status === "pending" ? "4 4" : undefined} />
                {cross && (
                  <text x={(sx + ex) / 2} y={Math.min(sy, ey) - 90} fontSize={11} textAnchor="middle" className="fill-muted">
                    root cause crosses to the left side
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {placed.map(({ s, p }, i) =>
          s.v_side === "gate" ? (
            <Gate key={s.key} def={s} run={runs[s.key]} x={p[0]} y={p[1]} selected={selected === s.key} onSelect={onSelect} />
          ) : (
            <div key={s.key} className="absolute" style={{ left: p[0] - CARD_W / 2, top: p[1] - 29, width: CARD_W }}>
              <StageCard def={s} run={runs[s.key]} index={i} selected={selected === s.key} onSelect={onSelect} compact />
            </div>
          ),
        )}
      </div>
    </div>
  );
}

const GATE_TONE: Record<string, string> = {
  passed: "border-ok bg-ok/10",
  awaiting_approval: "border-warn bg-warn/15 ring-4 ring-warn/15",
  failed: "border-bad bg-bad/10",
  running: "border-run bg-run/10",
};

/** Release gate drawn as a diamond marker rather than a stage card. */
function Gate({ def, run, x, y, selected, onSelect }: { def: StageDef; run?: StageRun; x: number; y: number; selected: boolean; onSelect: (k: string) => void }) {
  const status = run?.status ?? "pending";
  return (
    <button type="button" onClick={() => onSelect(def.key)} className="group absolute flex flex-col items-center" style={{ left: x - 60, top: y - 18, width: 120 }}>
      <span
        className={cn(
          "h-9 w-9 rotate-45 rounded-[4px] border-2 bg-surface transition-shadow group-hover:shadow-md",
          GATE_TONE[status] ?? "border-dashed border-muted/60",
          selected && "outline outline-2 outline-offset-2 outline-accent",
        )}
      />
      <span className="mt-2.5 text-[12px] font-semibold">{def.name}</span>
      <span className={cn("text-[11px]", status === "awaiting_approval" ? "text-warn" : status === "passed" ? "text-ok" : "text-muted")}>{STATUS_LABEL[status]}</span>
    </button>
  );
}

import type { StageDef, StageRun, StageStatus } from "@/lib/api";
import { STATUS_LABEL } from "@/components/domain";
import { fmtDuration } from "@/lib/utils";

// Schematic of the V-model drawn on a fixed canvas and scaled by the viewBox.
// The case enters from the field (top band), descends the right side while it is diagnosed,
// crosses to the left at root cause, goes down to implementation and climbs the right side
// back to the vehicle, where monitoring closes the loop.
const W = 1140;
const H = 500;
const Y = { field: 58, l1: 150, l2: 248, l3: 346, l4: 440 };
const TOP_L: P = [190, Y.l1];
const BOTTOM: P = [530, Y.l4];
const TOP_R: P = [870, Y.l1];
const R = 16;

type P = [number, number];
type Side = "left" | "right" | "above" | "below";

const POS: Record<string, { p: P; label: Side }> = {
  detect: { p: [490, Y.field], label: "above" },
  triage: { p: [610, Y.field], label: "above" },
  ticket: { p: [730, Y.field], label: "above" },
  fleet: { p: [690, Y.l1], label: "right" },
  reproduce: { p: [580, Y.l2], label: "right" },
  rca: { p: [305, Y.l2], label: "left" },
  requirement: { p: TOP_L, label: "above" },
  fix: { p: BOTTOM, label: "below" },
  verify: { p: [640, Y.l3], label: "right" },
  approve: { p: [755, Y.l2], label: "right" },
  release: { p: TOP_R, label: "right" },
  monitor: { p: [870, Y.field], label: "right" },
};

const LEVELS: { y: number; left?: string; right?: string }[] = [
  { y: Y.l1, left: "Requirements", right: "Vehicle validation" },
  { y: Y.l2, left: "Architecture", right: "System integration" },
  { y: Y.l3, left: "Detailed design", right: "Unit / integration test" },
  { y: Y.l4, left: "Implementation" },
];

const TONE: Record<StageStatus, { stroke: string; fill: string; text: string }> = {
  pending: { stroke: "hsl(var(--strong))", fill: "hsl(var(--surface))", text: "hsl(var(--faint))" },
  skipped: { stroke: "hsl(var(--strong))", fill: "hsl(var(--surface))", text: "hsl(var(--faint))" },
  running: { stroke: "hsl(var(--run))", fill: "hsl(var(--run) / 0.14)", text: "hsl(var(--run))" },
  passed: { stroke: "hsl(var(--ok))", fill: "hsl(var(--ok) / 0.12)", text: "hsl(var(--ok))" },
  awaiting_approval: { stroke: "hsl(var(--warn))", fill: "hsl(var(--warn) / 0.16)", text: "hsl(var(--warn))" },
  failed: { stroke: "hsl(var(--bad))", fill: "hsl(var(--bad) / 0.14)", text: "hsl(var(--bad))" },
};

const isLive = (s?: StageStatus) => s === "running" || s === "awaiting_approval";

export function VModelView({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  // Unknown (future) stages get a slot along the bottom-left so the view stays extensible.
  let extra = 0;
  const placed = stages.map((s, i) => ({ s, i, ...(POS[s.key] ?? { p: [60 + extra++ * 150, H - 24] as P, label: "right" as Side }) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none" role="img" aria-label="V-model view of the pipeline">
      <defs>
        <marker id="vm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
        <linearGradient id="vm-band" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="hsl(var(--fg))" stopOpacity="0.07" />
          <stop offset="1" stopColor="hsl(var(--fg))" stopOpacity="0.025" />
        </linearGradient>
      </defs>

      {/* level rules and gutter labels */}
      {LEVELS.map((l) => (
        <g key={l.y}>
          <line x1={12} x2={W - 12} y1={l.y} y2={l.y} stroke="hsl(var(--border))" strokeDasharray="1 5" />
          {l.left && <text x={12} y={l.y - 8} fontSize={11} className="fill-faint font-sans">{l.left}</text>}
          {l.right && <text x={W - 12} y={l.y - 8} fontSize={11} textAnchor="end" className="fill-faint font-sans">{l.right}</text>}
        </g>
      ))}

      {/* field band */}
      <rect x={420} y={14} width={580} height={84} rx={4} fill="hsl(var(--accent) / 0.04)" stroke="hsl(var(--accent) / 0.2)" />

      {/* the V */}
      <path d={`M ${TOP_L} L ${BOTTOM} L ${TOP_R}`} fill="none" stroke="url(#vm-band)" strokeWidth={44} strokeLinejoin="round" strokeLinecap="round" />
      <path d={`M ${TOP_L} L ${BOTTOM} L ${TOP_R}`} fill="none" stroke="hsl(var(--strong))" strokeWidth={1} strokeDasharray="1 4" />

      {/* flow */}
      {placed.slice(1).map((cur, k) => {
        const prev = placed[k];
        const a = runs[prev.s.key]?.status;
        const b = runs[cur.s.key]?.status;
        const active = a === "passed" && isLive(b);
        const done = a === "passed" && !!b && b !== "pending" && !active;
        const stroke = active ? "hsl(var(--run))" : done ? "hsl(var(--ok) / 0.75)" : "hsl(var(--faint) / 0.55)";
        const d = edgePath(prev.s.key, cur.s.key, prev.p, cur.p);
        return (
          <g key={cur.s.key}>
            <path d={d} fill="none" stroke={stroke} strokeWidth={active ? 2 : 1.5} strokeDasharray={active ? "6 6" : done ? undefined : "3 4"} className={active ? "svg-flow" : undefined} markerEnd="url(#vm-arrow)" />
          </g>
        );
      })}

      {/* nodes */}
      {placed.map(({ s, i, p, label }) => (
        <Node key={s.key} def={s} index={i} run={runs[s.key]} p={p} side={label} selected={selected === s.key} onSelect={onSelect} />
      ))}
    </svg>
  );
}

/** Straight edge trimmed to the node rims; requirement → fix bows inward so it doesn't retrace the left arm. */
function edgePath(from: string, to: string, a: P, b: P): string {
  if (from === "requirement" && to === "fix") {
    // Parallel lane on the inner side of the left arm.
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const off: P = [((b[1] - a[1]) / len) * 15, (-(b[0] - a[0]) / len) * 15];
    const sa: P = [a[0] + off[0], a[1] + off[1]];
    const sb: P = [b[0] + off[0], b[1] + off[1]];
    return `M ${toward(sa, sb, R + 2)} L ${toward(sb, sa, R + 4)}`;
  }
  return `M ${toward(a, b, R + 4)} L ${toward(b, a, R + 6)}`;
}

function toward(from: P, to: P, dist: number): P {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / len) * dist, from[1] + (dy / len) * dist];
}

function Node({ def, index, run, p, side, selected, onSelect }: { def: StageDef; index: number; run?: StageRun; p: P; side: Side; selected: boolean; onSelect: (k: string) => void }) {
  const status = run?.status ?? "pending";
  const t = TONE[status];
  const gate = def.v_side === "gate";
  const [x, y] = p;
  const sub = status === "passed" || status === "failed" ? `${STATUS_LABEL[status]}${run?.started_at ? ` · ${fmtDuration(run.started_at, run.ended_at)}` : ""}` : STATUS_LABEL[status];
  const pad = R + (gate ? 16 : 10);
  const lx = side === "left" ? x - pad : side === "right" ? x + pad : x;
  const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
  const ly = side === "above" ? y - R - 22 : side === "below" ? y + R + 18 : y - 2;
  const pending = status === "pending";

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${def.name}: ${STATUS_LABEL[status]}`}
      onClick={() => onSelect(def.key)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(def.key)}
      className="group cursor-pointer outline-none"
    >
      <circle cx={x} cy={y} r={R + 14} fill="transparent" />
      {status === "awaiting_approval" && <circle cx={x} cy={y} r={R + 10} fill="hsl(var(--warn) / 0.14)" className="svg-pulse" />}
      {status === "running" && <circle cx={x} cy={y} r={R + 6} fill="none" stroke="hsl(var(--run))" strokeWidth={1.25} strokeDasharray="3 4" className="svg-spin" />}
      {selected && <circle cx={x} cy={y} r={R + 9} fill="none" stroke="hsl(var(--fg))" strokeWidth={1.25} />}
      <circle cx={x} cy={y} r={R + 9} fill="none" stroke="hsl(var(--fg) / 0.35)" strokeWidth={1} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      {gate ? (
        <rect x={x - 13} y={y - 13} width={26} height={26} rx={2} transform={`rotate(45 ${x} ${y})`} fill={t.fill} stroke={t.stroke} strokeWidth={1.5} />
      ) : (
        <circle cx={x} cy={y} r={R} fill={t.fill} stroke={t.stroke} strokeWidth={1.5} />
      )}
      {status === "passed" && !gate ? (
        <path d={`M ${x - 5} ${y} l 3.5 3.5 l 6.5 -7`} fill="none" stroke={t.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <text x={x} y={y + 3.5} fontSize={10.5} textAnchor="middle" fill={t.text} className="tnum font-mono" fontWeight={500}>
          {String(index + 1).padStart(2, "0")}
        </text>
      )}
      <text x={lx} y={ly} textAnchor={anchor} fontSize={14} fontWeight={600} fill={pending ? "hsl(var(--muted))" : "hsl(var(--fg))"} letterSpacing={-0.2}>
        {def.name}
      </text>
      {(status === "running" || status === "awaiting_approval" || status === "failed") && (
        <text x={lx} y={ly + 15} textAnchor={anchor} fontSize={11} fill={t.text} className="font-sans font-semibold">
          {sub}
        </text>
      )}
    </g>
  );
}

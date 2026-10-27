import { Activity, Car, Check, FileText, FlaskConical, GitCommitHorizontal, Pause, Rocket, ScanSearch, ShieldCheck, Sparkles, Telescope, Ticket, UserCheck, Wrench, X, type LucideIcon } from "lucide-react";
import type { StageDef, StageRun, StageStatus } from "@/lib/api";
import { STATUS_LABEL } from "@/components/domain";
import { fmtDuration } from "@/lib/utils";

// Schematic of the V-model drawn on a fixed canvas and scaled by the viewBox.
// The case enters from the field (top band), descends the right side while it is diagnosed,
// crosses to the left at root cause, goes down to implementation and climbs the right side
// back to the vehicle, where monitoring closes the loop.
const W = 1000;
const H = 556;
const FIELD_Y = 72;
const Y = { l1: 210, l2: 300, l3: 390, l4: 478 };
const TOP_L: P = [180, Y.l1];
const BOTTOM: P = [500, Y.l4];
const TOP_R: P = [820, Y.l1];
const R = 20;

type P = [number, number];
type Side = "left" | "right" | "above" | "below";

// Point on an arm of the V at a given level, so nodes sit exactly on the arms.
const onArm = (top: P, y: number): P => [top[0] + (BOTTOM[0] - top[0]) * ((y - top[1]) / (BOTTOM[1] - top[1])), y];

const POS: Record<string, { p: P; label: Side }> = {
  field_discovery: { p: [170, FIELD_Y], label: "below" },
  detect: { p: [300, FIELD_Y], label: "below" },
  triage: { p: [430, FIELD_Y], label: "below" },
  ticket: { p: [560, FIELD_Y], label: "below" },
  fleet: { p: [680, Y.l1], label: "left" },
  reproduce: { p: [560, Y.l2], label: "below" },
  rca: { p: onArm(TOP_L, Y.l2), label: "left" },
  requirement: { p: TOP_L, label: "above" },
  fix: { p: BOTTOM, label: "below" },
  verify: { p: onArm(TOP_R, Y.l3), label: "left" },
  approve: { p: onArm(TOP_R, Y.l2), label: "right" },
  release: { p: TOP_R, label: "right" },
  monitor: { p: [820, FIELD_Y], label: "right" },
};

const ICON: Record<string, LucideIcon> = {
  field_discovery: Telescope,
  detect: ScanSearch,
  triage: Sparkles,
  ticket: Ticket,
  fleet: Car,
  reproduce: FlaskConical,
  rca: GitCommitHorizontal,
  requirement: FileText,
  fix: Wrench,
  verify: ShieldCheck,
  approve: UserCheck,
  release: Rocket,
  monitor: Activity,
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
  running: { stroke: "hsl(var(--run))", fill: "hsl(var(--surface))", text: "hsl(var(--run))" },
  passed: { stroke: "hsl(var(--ok))", fill: "hsl(var(--surface))", text: "hsl(var(--ok))" },
  awaiting_approval: { stroke: "hsl(var(--warn))", fill: "hsl(var(--surface))", text: "hsl(var(--warn))" },
  failed: { stroke: "hsl(var(--bad))", fill: "hsl(var(--surface))", text: "hsl(var(--bad))" },
};

const isLive = (s?: StageStatus) => s === "running" || s === "awaiting_approval";
// Halo so labels stay legible where they cross lines and bands.
const halo = { paintOrder: "stroke" as const, stroke: "hsl(var(--surface))", strokeWidth: 5, strokeLinejoin: "round" as const };

export function VModelView({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  // Unknown (future) stages get a slot along the bottom-left so the view stays extensible.
  let extra = 0;
  const placed = stages.map((s, i) => ({ s, i, ...(POS[s.key] ?? { p: [60 + extra++ * 150, H - 70] as P, label: "right" as Side }) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full select-none font-sans" role="img" aria-label="V-model view of the pipeline">
      <defs>
        <marker id="vm-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
        </marker>
      </defs>

      {/* field band */}
      <rect x={24} y={14} width={W - 48} height={124} rx={14} fill="hsl(var(--accent) / 0.05)" stroke="hsl(var(--accent) / 0.2)" />
      <Car x={40} y={26} width={15} height={15} strokeWidth={2.25} color="hsl(var(--accent))" />
      <text x={62} y={38} fontSize={12.5} fontWeight={600} className="fill-accent">In the field</text>

      {/* level rules and gutter labels */}
      {LEVELS.map((l) => (
        <g key={l.y}>
          <line x1={24} x2={W - 24} y1={l.y} y2={l.y} stroke="hsl(var(--border))" strokeDasharray="2 6" />
          {l.left && <text x={24} y={l.y - 12} fontSize={12} className="fill-faint">{l.left}</text>}
          {l.right && <text x={W - 24} y={l.y - 12} fontSize={12} textAnchor="end" className="fill-faint">{l.right}</text>}
        </g>
      ))}

      {/* the V: specify & build on the left arm, verify & validate on the right */}
      <path d={`M ${TOP_L} L ${BOTTOM}`} fill="none" stroke="hsl(var(--accent) / 0.09)" strokeWidth={46} strokeLinecap="round" />
      <path d={`M ${BOTTOM} L ${TOP_R}`} fill="none" stroke="hsl(var(--ok) / 0.10)" strokeWidth={46} strokeLinecap="round" />

      {/* flow */}
      {placed.slice(1).map((cur, k) => {
        const prev = placed[k];
        const a = runs[prev.s.key]?.status;
        const b = runs[cur.s.key]?.status;
        const active = a === "passed" && isLive(b);
        const done = a === "passed" && !!b && b !== "pending" && !active;
        const stroke = active ? "hsl(var(--run))" : done ? "hsl(var(--ok) / 0.7)" : "hsl(var(--faint) / 0.5)";
        return (
          <path
            key={cur.s.key}
            d={edgePath(prev.s.key, cur.s.key, prev.p, cur.p)}
            fill="none"
            stroke={stroke}
            strokeWidth={active ? 2.5 : 2}
            strokeDasharray={active ? "6 6" : done ? undefined : "3 5"}
            className={active ? "svg-flow" : undefined}
            markerEnd="url(#vm-arrow)"
          />
        );
      })}

      {/* nodes */}
      {placed.map(({ s, i, p, label }) => (
        <Node key={s.key} def={s} index={i} run={runs[s.key]} p={p} side={label} selected={selected === s.key} onSelect={onSelect} />
      ))}

      {/* legend, laid out right-to-left from the bottom-right corner */}
      <g transform={`translate(${W - 24} ${H - 14})`} fontSize={12} className="fill-muted">
        <Legend />
      </g>
    </svg>
  );
}

const LEGEND: { w: number; text: string; swatch: React.ReactNode }[] = [
  { w: 116, text: "Specify & build", swatch: <rect x={0} y={-9} width={18} height={10} rx={5} fill="hsl(var(--accent) / 0.18)" /> },
  { w: 122, text: "Verify & validate", swatch: <rect x={0} y={-9} width={18} height={10} rx={5} fill="hsl(var(--ok) / 0.22)" /> },
  { w: 96, text: "Human gate", swatch: <rect x={4} y={-10} width={10} height={10} transform="rotate(45 9 -5)" fill="hsl(var(--warn) / 0.25)" stroke="hsl(var(--warn))" /> },
];

function Legend() {
  let x = 0;
  return (
    <>
      {[...LEGEND].reverse().map((it) => {
        x -= it.w + 24;
        return (
          <g key={it.text} transform={`translate(${x} 0)`}>
            {it.swatch}
            <text x={26} y={0}>{it.text}</text>
          </g>
        );
      })}
    </>
  );
}

/** Straight edge trimmed to the node rims; requirement → fix bows inward so it doesn't retrace the left arm. */
function edgePath(from: string, to: string, a: P, b: P): string {
  if (from === "requirement" && to === "fix") {
    // Parallel lane on the inner side of the left arm.
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const off: P = [((b[1] - a[1]) / len) * 16, (-(b[0] - a[0]) / len) * 16];
    const sa: P = [a[0] + off[0], a[1] + off[1]];
    const sb: P = [b[0] + off[0], b[1] + off[1]];
    return `M ${toward(sa, sb, R + 2)} L ${toward(sb, sa, R + 4)}`;
  }
  return `M ${toward(a, b, R + 4)} L ${toward(b, a, R + 7)}`;
}

function toward(from: P, to: P, dist: number): P {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const len = Math.hypot(dx, dy) || 1;
  return [from[0] + (dx / len) * dist, from[1] + (dy / len) * dist];
}

/** Small corner badge: the stage's state at a glance, next to its icon. */
function StatusBadge({ status, x, y }: { status: StageStatus; x: number; y: number }) {
  if (status === "pending" || status === "skipped") return null;
  const glyph = { x: x - 4.5, y: y - 4.5, width: 9, height: 9, strokeWidth: 3.5, color: "hsl(var(--surface))" };
  return (
    <g>
      <circle cx={x} cy={y} r={7.5} fill={TONE[status].stroke} stroke="hsl(var(--surface))" strokeWidth={2} />
      {status === "passed" && <Check {...glyph} />}
      {status === "failed" && <X {...glyph} />}
      {status === "awaiting_approval" && <Pause {...glyph} />}
      {status === "running" && <circle cx={x} cy={y} r={2.5} fill="hsl(var(--surface))" className="svg-pulse" />}
    </g>
  );
}

function Node({ def, index, run, p, side, selected, onSelect }: { def: StageDef; index: number; run?: StageRun; p: P; side: Side; selected: boolean; onSelect: (k: string) => void }) {
  const status = run?.status ?? "pending";
  const t = TONE[status];
  const gate = def.v_side === "gate";
  const Icon = ICON[def.key] ?? Activity;
  const [x, y] = p;
  const duration = run?.started_at && status !== "pending" ? fmtDuration(run.started_at, run.ended_at) : "";
  const sub = status === "running" || status === "awaiting_approval" || status === "failed" ? STATUS_LABEL[status] : "";
  const pad = R + (gate ? 16 : 14);
  const lx = side === "left" ? x - pad : side === "right" ? x + pad : x;
  const anchor = side === "left" ? "end" : side === "right" ? "start" : "middle";
  const ly = side === "above" ? y - R - (sub ? 26 : 12) : side === "below" ? y + R + 20 : y + 5;
  const pending = status === "pending" || status === "skipped";

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${def.name}: ${STATUS_LABEL[status]}`}
      onClick={() => onSelect(def.key)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect(def.key)}
      className="group cursor-pointer outline-none"
    >
      <title>{`${String(index + 1).padStart(2, "0")} · ${def.name} — ${STATUS_LABEL[status]}${duration ? ` · ${duration}` : ""}`}</title>
      <circle cx={x} cy={y} r={R + 14} fill="transparent" />
      {status === "awaiting_approval" && <circle cx={x} cy={y} r={R + 11} fill="hsl(var(--warn) / 0.16)" className="svg-pulse" />}
      {status === "running" && <circle cx={x} cy={y} r={R + 6} fill="none" stroke="hsl(var(--run))" strokeWidth={1.5} strokeDasharray="4 4" className="svg-spin" />}
      {selected && <circle cx={x} cy={y} r={R + 8} fill="hsl(var(--accent) / 0.1)" stroke="hsl(var(--accent))" strokeWidth={2} />}
      <circle cx={x} cy={y} r={R + 8} fill="none" stroke="hsl(var(--fg) / 0.25)" strokeWidth={1} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      {gate ? (
        <rect x={x - 17} y={y - 17} width={34} height={34} rx={4} transform={`rotate(45 ${x} ${y})`} fill={pending ? "hsl(var(--surface))" : "hsl(var(--warn) / 0.14)"} stroke="hsl(var(--warn))" strokeWidth={2} />
      ) : (
        <circle cx={x} cy={y} r={R} fill={t.fill} stroke={t.stroke} strokeWidth={pending ? 1.5 : 2.5} />
      )}
      <Icon x={x - 9} y={y - 9} width={18} height={18} strokeWidth={2} color={gate && pending ? "hsl(var(--warn))" : t.text} />
      <StatusBadge status={status} x={x + R * 0.72} y={y + R * 0.72} />
      <text x={lx} y={ly} textAnchor={anchor} fontSize={14.5} fontWeight={selected ? 700 : 600} fill={selected ? "hsl(var(--accent))" : pending ? "hsl(var(--muted))" : "hsl(var(--fg))"} style={halo}>
        {def.name}
      </text>
      {sub && (
        <text x={lx} y={ly + 16} textAnchor={anchor} fontSize={12} fontWeight={600} fill={t.text} style={halo}>
          {sub}
        </text>
      )}
    </g>
  );
}

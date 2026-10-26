import { memo, useMemo } from "react";
import { Background, Handle, Position, ReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ShieldCheck } from "lucide-react";
import type { StageDef, StageRun } from "@/lib/api";
import { STATUS_LABEL, StatusIcon } from "@/components/domain";
import { cn, fmtDuration } from "@/lib/utils";

const W = 184;
const H = 84;
const GAP_X = 40;
const ROW_Y = [32, 196];
const PER_ROW = 6;
// Lane labels sit above the last column so the row-wrap edge never crosses them.
const LANE_X = (PER_ROW - 1) * (W + GAP_X);

export type StageNodeData = { def: StageDef; run?: StageRun; index: number; selected: boolean; onSelect: (k: string) => void };

const statusBorder: Record<string, string> = {
  running: "border-run ring-2 ring-run/15",
  awaiting_approval: "border-warn ring-2 ring-warn/15",
  failed: "border-bad",
  passed: "border-border",
  pending: "border-border border-dashed",
  skipped: "border-border",
};

export const StageCard = memo(function StageCard({ def, run, index, selected, onSelect, compact = false }: StageNodeData & { compact?: boolean }) {
  const status = run?.status ?? "pending";
  const pending = status === "pending";
  const isGate = def.v_side === "gate";
  return (
    <button
      type="button"
      onClick={() => onSelect(def.key)}
      className={cn(
        "group flex w-full flex-col rounded-md border bg-surface text-left transition-shadow hover:shadow-md",
        statusBorder[status],
        selected && "outline outline-2 outline-offset-2 outline-accent",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
      )}
      style={{ height: compact ? 58 : H }}
    >
      <div className="flex items-center gap-1.5">
        <span className="tnum text-[11px] font-medium text-muted">{String(index + 1).padStart(2, "0")}</span>
        {isGate && <ShieldCheck size={12} className="text-warn" />}
        <span className={cn("truncate text-[13px] font-semibold", pending && "text-muted")}>{def.name}</span>
        <StatusIcon status={status} size={13} className="ml-auto" />
      </div>
      {!compact && <div className="mt-1 truncate text-[11px] text-muted">{def.agent}</div>}
      <div className="mt-auto flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px]">
        <span className={cn("shrink-0 font-medium", status === "running" ? "text-run" : status === "awaiting_approval" ? "text-warn" : status === "failed" ? "text-bad" : status === "passed" ? "text-ok" : "text-muted")}>
          {STATUS_LABEL[status]}
        </span>
        {!compact && run?.started_at ? <span className="tnum shrink-0 text-muted">· {fmtDuration(run.started_at, run.ended_at)}</span> : null}
        <span className="ml-auto flex min-w-0 items-center gap-1">
          {run?.connector && !compact && <span title={run.connector} className="min-w-0 max-w-[64px] truncate rounded bg-subtle px-1 py-px text-[10px] text-muted">{run.connector}</span>}
          {run?.simulated && (
            <span title="Connector ran in simulated mode" className="shrink-0 rounded border border-dashed border-muted/50 px-1 py-px text-[10px] text-muted">
              sim
            </span>
          )}
        </span>
      </div>
    </button>
  );
});

function StageNode({ data }: NodeProps<Node<StageNodeData>>) {
  return (
    <div style={{ width: W }}>
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="target" position={Position.Top} id="t" />
      <StageCard {...data} />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="source" position={Position.Bottom} id="b" />
    </div>
  );
}

function LaneLabel({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="whitespace-nowrap text-right text-[11px] font-medium uppercase tracking-wider text-muted" style={{ width: W }}>{data.label}</div>;
}

const nodeTypes = { stage: StageNode, lane: LaneLabel };

export function PipelineGraph({ stages, runs, selected, onSelect }: { stages: StageDef[]; runs: Record<string, StageRun>; selected: string | null; onSelect: (k: string) => void }) {
  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [
      { id: "lane-0", type: "lane", position: { x: LANE_X, y: ROW_Y[0] - 22 }, data: { label: "Detect & diagnose" }, draggable: false, selectable: false },
      { id: "lane-1", type: "lane", position: { x: LANE_X, y: ROW_Y[1] - 22 }, data: { label: "Fix, verify & release" }, draggable: false, selectable: false },
    ];
    const edges: Edge[] = [];
    stages.forEach((def, i) => {
      const row = Math.min(1, Math.floor(i / PER_ROW));
      const col = row === 0 ? i : i - PER_ROW;
      nodes.push({
        id: def.key,
        type: "stage",
        position: { x: col * (W + GAP_X), y: ROW_Y[row] },
        data: { def, run: runs[def.key], index: i, selected: selected === def.key, onSelect } satisfies StageNodeData,
        draggable: false,
      });
      if (i > 0) {
        const prev = stages[i - 1];
        const wrap = i === PER_ROW;
        const prevSt = runs[prev.key]?.status;
        const curSt = runs[def.key]?.status;
        const active = prevSt === "passed" && (curSt === "running" || curSt === "awaiting_approval");
        const done = prevSt === "passed" && curSt && curSt !== "pending";
        edges.push({
          id: `${prev.key}->${def.key}`,
          source: prev.key,
          target: def.key,
          sourceHandle: wrap ? "b" : "r",
          targetHandle: wrap ? "t" : "l",
          type: wrap ? "smoothstep" : "default",
          animated: active,
          className: active ? "active" : done ? "done" : undefined,
        });
      }
    });
    return { nodes, edges };
  }, [stages, runs, selected, onSelect]);

  return (
    <div className="h-[300px] w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.4}
        maxZoom={1.25}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnScroll
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} color="hsl(var(--border))" />
      </ReactFlow>
    </div>
  );
}

import {
  Check,
  Cpu,
  Database,
  ExternalLink,
  GitPullRequest,
  Github,
  Globe,
  Hash,
  MessageSquare,
  Radio,
  Server,
  ShieldCheck,
  Ticket,
  X,
} from "lucide-react";
import type { CaseStatus, Link, SignalSource, StageDef, StageRun, StageStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Tip } from "./ui/tooltip";

export const STATUS_LABEL: Record<StageStatus, string> = {
  pending: "Pending",
  running: "Running",
  passed: "Passed",
  failed: "Failed",
  awaiting_approval: "Awaiting approval",
  skipped: "Skipped",
};

const STATUS_TONE: Record<StageStatus, "neutral" | "run" | "ok" | "bad" | "warn" | "outline"> = {
  pending: "outline",
  running: "run",
  passed: "ok",
  failed: "bad",
  awaiting_approval: "warn",
  skipped: "neutral",
};

/** Text colour class per stage status. */
export const STATUS_TEXT: Record<StageStatus, string> = {
  pending: "text-faint",
  running: "text-run",
  passed: "text-ok",
  failed: "text-bad",
  awaiting_approval: "text-warn",
  skipped: "text-faint",
};

/** Small geometric status glyph: square = stage, filled = done, pulsing = live. */
export function StatusIcon({ status, size = 12, className }: { status: StageStatus; size?: number; className?: string }) {
  const box = cn("inline-flex shrink-0 items-center justify-center rounded-[2px]", className);
  const s = { width: size, height: size };
  switch (status) {
    case "passed":
      return <span className={cn(box, "bg-ok text-bg")} style={s}><Check size={size - 3} strokeWidth={3.25} /></span>;
    case "failed":
      return <span className={cn(box, "bg-bad text-bg")} style={s}><X size={size - 3} strokeWidth={3.25} /></span>;
    case "running":
      return (
        <span className={cn(box, "border border-run")} style={s}>
          <span className="animate-pulseSoft rounded-[1px] bg-run" style={{ width: size / 2, height: size / 2 }} />
        </span>
      );
    case "awaiting_approval":
      return (
        <span className={cn(box, "animate-pulseSoft")} style={s}>
          <span className="rotate-45 rounded-[1px] bg-warn" style={{ width: size * 0.66, height: size * 0.66 }} />
        </span>
      );
    case "skipped":
      return <span className={cn(box, "border border-dashed border-faint")} style={s} />;
    default:
      return <span className={cn(box, "border border-strong")} style={s} />;
  }
}

export function StageStatusChip({ status }: { status: StageStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <StatusIcon status={status} size={9} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const CASE_STATUS: Record<CaseStatus, { label: string; tone: "neutral" | "run" | "ok" | "bad" | "warn" | "accent" | "info" }> = {
  open: { label: "Open", tone: "neutral" },
  running: { label: "Pipeline running", tone: "run" },
  awaiting_approval: { label: "Awaiting approval", tone: "warn" },
  releasing: { label: "Releasing", tone: "info" },
  closed: { label: "Closed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
};

export function CaseStatusChip({ status }: { status: CaseStatus }) {
  const s = CASE_STATUS[status] ?? { label: status, tone: "neutral" as const };
  const live = status === "running" || status === "awaiting_approval" || status === "releasing";
  return (
    <Badge tone={s.tone}>
      <span className={cn("h-1.5 w-1.5 rounded-full bg-current", live && "animate-pulseSoft")} />
      {s.label}
    </Badge>
  );
}

const SEVERITY_LEVEL: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/** Severity as a 4-step meter plus label, readable at a glance in dense tables. */
export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <span className="text-faint">—</span>;
  const lvl = SEVERITY_LEVEL[severity] ?? 1;
  const color = lvl >= 3 ? "bg-bad" : lvl === 2 ? "bg-warn" : "bg-muted";
  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <span className="flex items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cn("w-[3px] rounded-[1px]", i <= lvl ? color : "bg-border")} style={{ height: 4 + i * 2 }} />
        ))}
      </span>
      <span className={lvl >= 3 ? "text-bad" : lvl === 2 ? "text-warn" : "text-muted"}>{severity}</span>
    </span>
  );
}

export const SOURCE_META: Record<SignalSource, { label: string; icon: typeof Globe; color: string }> = {
  reddit: { label: "Reddit", icon: MessageSquare, color: "#E56910" },
  forum: { label: "Owners forum", icon: Globe, color: "#2898BD" },
  x: { label: "X", icon: Hash, color: "#758195" },
  issuetracker: { label: "Issue Tracker", icon: Ticket, color: "#8270DB" },
  partner_jira: { label: "Partner Jira", icon: Ticket, color: "#1D7AFC" },
  device: { label: "hu-sentinel", icon: Cpu, color: "#B38600" },
};

export const SOURCES = Object.keys(SOURCE_META) as SignalSource[];

export function SourceBadge({ source }: { source: SignalSource }) {
  const m = SOURCE_META[source] ?? { label: source, icon: Radio, color: "#888" };
  const Icon = m.icon;
  return (
    <span className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap text-xs text-fg">
      <span className="flex h-5 w-5 items-center justify-center rounded-sm" style={{ background: `${m.color}1f`, color: m.color }}>
        <Icon size={11} strokeWidth={2} />
      </span>
      {m.label}
    </span>
  );
}

export function ToolIcon({ tool, size = 14, className }: { tool: string; size?: number; className?: string }) {
  const p = { size, className: cn("shrink-0 text-muted", className) };
  switch (tool) {
    case "github":
      return <Github {...p} />;
    case "gitlab":
      return <GitPullRequest {...p} />;
    case "jira":
    case "partner_jira":
      return <Ticket {...p} />;
    case "iot":
    case "ota":
      return <Radio {...p} />;
    case "athena":
    case "s3":
    case "dynamodb":
      return <Database {...p} />;
    case "forum":
    case "reddit":
      return <MessageSquare {...p} />;
    case "signer":
      return <ShieldCheck {...p} />;
    case "codebuild":
    case "ci":
      return <Server {...p} />;
    default:
      return <ExternalLink {...p} />;
  }
}

export function LinkChip({ link }: { link: Link }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex h-7 items-center gap-2 rounded border border-border bg-surface pl-2 pr-2.5 text-xs font-medium transition-colors hover:border-accent/50"
    >
      <ToolIcon tool={link.tool} size={13} className="group-hover:text-accent" />
      <span className="text-xs text-faint">{link.tool}</span>
      <span className="max-w-[260px] truncate">{link.label}</span>
    </a>
  );
}

const SEG: Record<StageStatus, string> = {
  pending: "bg-border",
  running: "bg-run animate-pulseSoft",
  passed: "bg-ok",
  failed: "bg-bad",
  awaiting_approval: "bg-warn animate-pulseSoft",
  skipped: "bg-faint/40",
};

/** Compact 12-segment progress tape for tables. */
export function StageStrip({ stages, runs }: { stages: StageDef[]; runs: Partial<Record<string, StageStatus>> }) {
  const done = stages.filter((s) => runs[s.key] === "passed").length;
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center gap-[2px]">
        {stages.map((s, i) => {
          const st = runs[s.key] ?? "pending";
          return (
            <Tip key={s.key} content={`${String(i + 1).padStart(2, "0")} ${s.name} · ${STATUS_LABEL[st]}`}>
              <span className={cn("h-[14px] w-[7px] rounded-[1px]", SEG[st])} />
            </Tip>
          );
        })}
      </div>
      <span className="tnum font-mono text-2xs text-faint">{String(done).padStart(2, "0")}/{stages.length}</span>
    </div>
  );
}

/** Derive stage statuses for a case from its current stage when per-stage runs aren't loaded. */
export function inferStageStatuses(stages: StageDef[], current: string | null, caseStatus: CaseStatus): Record<string, StageStatus> {
  const out: Record<string, StageStatus> = {};
  const idx = current ? stages.findIndex((s) => s.key === current) : -1;
  stages.forEach((s, i) => {
    if (caseStatus === "closed") out[s.key] = "passed";
    else if (idx < 0) out[s.key] = "pending";
    else if (i < idx) out[s.key] = "passed";
    else if (i === idx)
      out[s.key] = caseStatus === "awaiting_approval" ? "awaiting_approval" : caseStatus === "failed" ? "failed" : "running";
    else out[s.key] = "pending";
  });
  return out;
}

export function runsToStatusMap(runs: StageRun[]): Record<string, StageStatus> {
  return Object.fromEntries(runs.map((r) => [r.stage, r.status]));
}

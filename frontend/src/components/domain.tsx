import {
  CheckCircle2,
  CircleDashed,
  CircleSlash,
  Clock3,
  Cpu,
  Database,
  ExternalLink,
  GitPullRequest,
  Github,
  Globe,
  Hash,
  Loader2,
  MessageSquare,
  Radio,
  Server,
  ShieldCheck,
  Ticket,
  XCircle,
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

export function StatusIcon({ status, size = 14, className }: { status: StageStatus; size?: number; className?: string }) {
  const c = cn("shrink-0", className);
  switch (status) {
    case "passed":
      return <CheckCircle2 size={size} className={cn(c, "text-ok")} />;
    case "running":
      return <Loader2 size={size} className={cn(c, "animate-spin text-run")} />;
    case "failed":
      return <XCircle size={size} className={cn(c, "text-bad")} />;
    case "awaiting_approval":
      return <Clock3 size={size} className={cn(c, "text-warn")} />;
    case "skipped":
      return <CircleSlash size={size} className={cn(c, "text-muted")} />;
    default:
      return <CircleDashed size={size} className={cn(c, "text-muted/70")} />;
  }
}

export function StageStatusChip({ status }: { status: StageStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <StatusIcon status={status} size={12} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const CASE_STATUS: Record<CaseStatus, { label: string; tone: "neutral" | "run" | "ok" | "bad" | "warn" | "accent" }> = {
  open: { label: "Open", tone: "neutral" },
  running: { label: "Pipeline running", tone: "run" },
  awaiting_approval: { label: "Awaiting approval", tone: "warn" },
  releasing: { label: "Releasing", tone: "accent" },
  closed: { label: "Closed", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
};

export function CaseStatusChip({ status }: { status: CaseStatus }) {
  const s = CASE_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone}>
      {status === "running" && <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-run" />}
      {s.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <span className="text-muted">—</span>;
  const tone = severity === "critical" || severity === "high" ? "bad" : severity === "medium" ? "warn" : "neutral";
  return (
    <Badge tone={tone} className="capitalize">
      {severity}
    </Badge>
  );
}

export const SOURCE_META: Record<SignalSource, { label: string; icon: typeof Globe; color: string }> = {
  reddit: { label: "Reddit", icon: MessageSquare, color: "#f97316" },
  forum: { label: "Owners forum", icon: Globe, color: "#0ea5e9" },
  x: { label: "X", icon: Hash, color: "#64748b" },
  issuetracker: { label: "Issue Tracker", icon: Ticket, color: "#8b5cf6" },
  partner_jira: { label: "Partner Jira", icon: Ticket, color: "#14b8a6" },
  device: { label: "hu-sentinel", icon: Cpu, color: "#2563eb" },
};

export const SOURCES = Object.keys(SOURCE_META) as SignalSource[];

export function SourceBadge({ source }: { source: SignalSource }) {
  const m = SOURCE_META[source] ?? { label: source, icon: Radio, color: "#64748b" };
  const Icon = m.icon;
  return (
    <span className="inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded border border-border bg-surface px-1.5 text-xs font-medium">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
      <Icon size={12} className="text-muted" />
      {m.label}
    </span>
  );
}

export function ToolIcon({ tool, size = 14 }: { tool: string; size?: number }) {
  const p = { size, className: "shrink-0 text-muted" };
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
      className="inline-flex h-6 items-center gap-1.5 rounded border border-border bg-surface px-2 text-xs font-medium hover:border-accent/40 hover:text-accent"
    >
      <ToolIcon tool={link.tool} size={12} />
      {link.label}
    </a>
  );
}

const DOT: Record<StageStatus, string> = {
  pending: "bg-border",
  running: "bg-run animate-pulseSoft",
  passed: "bg-ok",
  failed: "bg-bad",
  awaiting_approval: "bg-warn",
  skipped: "bg-muted/40",
};

/** Compact 12-dot progress strip for tables. */
export function StageStrip({ stages, runs }: { stages: StageDef[]; runs: Partial<Record<string, StageStatus>> }) {
  return (
    <div className="flex items-center gap-1">
      {stages.map((s) => {
        const st = runs[s.key] ?? "pending";
        return (
          <Tip key={s.key} content={`${s.name} · ${STATUS_LABEL[st]}`}>
            <span className={cn("h-2 w-2 rounded-full", DOT[st])} />
          </Tip>
        );
      })}
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

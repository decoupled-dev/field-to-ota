// Typed client for the Field-to-Fix console API. Mirrors backend/app/models.py and docs/api.md.

export type SignalSource = "reddit" | "forum" | "x" | "issuetracker" | "partner_jira" | "device";

export interface Signal {
  id: string;
  source: SignalSource;
  external_id: string | null;
  url: string | null;
  author: string | null;
  title: string;
  body: string;
  created_at: number;
  component: string | null;
  sw_version: string | null;
  vehicle_model: string | null;
  conditions: string[];
  severity: string | null;
  is_bug: boolean | null;
  cluster_id: string | null;
  case_id: string | null;
  vin: string | null;
  rule_id: string | null;
  bundle_key: string | null;
  metrics: Record<string, unknown>;
}

export interface Link {
  tool: string;
  label: string;
  url: string;
}

export interface ChartContent {
  type: "bar" | "line";
  x: string;
  series: { key: string; label: string }[];
  data: Record<string, string | number>[];
}

export interface Artifact {
  name: string;
  kind: "log" | "diff" | "report" | "chart" | "bundle" | "text" | "json" | "test" | string;
  path: string | null;
  content: unknown;
}

export type StageStatus = "pending" | "running" | "passed" | "failed" | "awaiting_approval" | "skipped";

export interface LogLine {
  ts: number;
  level: "info" | "tool" | "thought" | "warn" | "error" | string;
  msg: string;
}

export interface StageRun {
  case_id: string;
  stage: string;
  status: StageStatus;
  agent: string;
  connector: string | null;
  started_at: number | null;
  ended_at: number | null;
  summary: string;
  reasoning: string;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  artifacts: Artifact[];
  links: Link[];
  logs: LogLine[];
  simulated: boolean;
}

export type CaseStatus = "open" | "running" | "awaiting_approval" | "releasing" | "closed" | "failed";

export interface Case {
  id: string;
  title: string;
  status: CaseStatus;
  severity: string;
  component: string | null;
  sw_version: string | null;
  fixed_version: string | null;
  vehicle_model: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  signal_ids: string[];
  affected_vins: number;
  fixed_vins: number;
  current_stage: string | null;
  links: Link[];
}

export interface StageDef {
  key: string;
  name: string;
  v_level: string;
  v_side: "left" | "right" | "bottom" | "field" | "gate" | string;
  agent: string;
  capability: string | null;
  description: string;
}

export interface Health {
  mode: "local" | "aws" | string;
  llm: "bedrock" | "offline" | string;
  version: string;
}

export interface Overview {
  kpis: {
    open_cases: number;
    closed_cases: number;
    mttr_minutes: number | null;
    vehicles_affected: number;
    vehicles_fixed: number;
    signals_24h: number;
  };
  signals_by_source: { source: SignalSource; count: number }[];
  signals_timeline: ({ t: number } & Partial<Record<SignalSource, number>>)[];
  cases: Case[];
}

export interface IntakeSource {
  source: SignalSource;
  label: string;
  kind: "poll" | "push";
  mode: "live" | "simulated" | "push";
  target: string;
  interval: number | null;
  status: "idle" | "checking" | "listening" | "error";
  last_checked: number | null;
  next_check: number | null;
  last_found: number;
  checks: number;
  error: string | null;
  total?: number;
  last_24h?: number;
  last_signal_at?: number | null;
}

export interface IntakeActivity {
  id: number;
  ts: number;
  source: SignalSource | null;
  kind: "check" | "found" | "triage" | "cluster" | "case" | "skip" | "error";
  text: string;
  count: number;
  signal_id?: string;
  cluster_id?: string;
  case_id?: string;
}

export interface Intake {
  sources: IntakeSource[];
  activity: IntakeActivity[];
}

export interface Cluster {
  id: string;
  title: string;
  size: number;
  authors: number;
  sources: Partial<Record<SignalSource, number>>;
  case_id: string | null;
  score: number;
  threshold: number;
  first_seen: number;
  last_seen: number;
  component: string | null;
  sw_version: string | null;
}

export interface CaseDetail {
  case: Case;
  stages: StageRun[];
  signals: Signal[];
}

export interface Fleet {
  total_vins: number;
  affected_vins: number;
  cohort: { vin: string; region: string; sw_version: string; min_temp_c: number; underruns: number; ota_status: string }[];
  by_region: { region: string; affected: number; total: number }[];
  by_version: { sw_version: string; affected: number; total: number }[];
  by_temp: { bucket: string; affected: number; total: number }[];
  rollout: { wave: string; targeted: number; succeeded: number; failed: number; in_progress: number };
  health: { t: number; underruns: number }[];
}

export interface ReportRef {
  type: "evidence" | "rca" | "fleet" | string;
  title: string;
  description: string;
  url: string;
}

export interface Integration {
  key: string;
  name: string;
  capability: string;
  status: "connected" | "simulated" | "available";
  description: string;
  stages: string[];
  vendor: string;
  config_keys?: string[];
}

export interface F2FEvent {
  type: string;
  case_id: string | null;
  data: Record<string, unknown>;
  ts: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<Health>("/health"),
  stages: () => req<StageDef[]>("/stages"),
  overview: () => req<Overview>("/overview"),
  integrations: () => req<Integration[]>("/integrations"),
  resetDemo: () => req<unknown>("/demo/reset", { method: "POST" }),
  signals: (q: { source?: string; case_id?: string } = {}) => {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return req<Signal[]>(`/signals${p.size ? `?${p}` : ""}`);
  },
  intake: () => req<Intake>("/intake"),
  clusters: () => req<Cluster[]>("/clusters"),
  promote: (id: string) => req<Case>(`/clusters/${encodeURIComponent(id)}/promote`, { method: "POST" }),
  cases: () => req<Case[]>("/cases"),
  caseDetail: (id: string) => req<CaseDetail>(`/cases/${encodeURIComponent(id)}`),
  approve: (id: string, approver: string, comment: string) =>
    req<Case>(`/cases/${encodeURIComponent(id)}/approve`, { method: "POST", body: JSON.stringify({ approver, comment }) }),
  reject: (id: string, approver: string, comment: string) =>
    req<Case>(`/cases/${encodeURIComponent(id)}/reject`, { method: "POST", body: JSON.stringify({ approver, comment }) }),
  fleet: (id: string) => req<Fleet>(`/cases/${encodeURIComponent(id)}/fleet`),
  reports: (id: string) => req<ReportRef[]>(`/cases/${encodeURIComponent(id)}/reports`),
};

export const reportUrl = (caseId: string, type: string) => `/api/cases/${encodeURIComponent(caseId)}/reports/${type}`;
export const artifactUrl = (path: string) => `/api/artifacts/${path.split("/").map(encodeURIComponent).join("/")}`;

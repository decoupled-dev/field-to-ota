import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight, Car, ChartColumn, ChartPie, FolderKanban, Radio, RotateCcw, Timer, TriangleAlert, type LucideIcon } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import { api, type Case, type F2FEvent, type IntakeActivity, type Overview, type Signal } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, IssueKey, SEVERITY, SeverityBadge, SOURCE_META, SOURCES, StageStrip, inferStageStatuses } from "@/components/domain";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, axis, grid, tooltipProps } from "@/components/charts";
import { useIntake } from "@/pages/signals/IntakeBoard";
import { cn, timeAgo } from "@/lib/utils";

export default function OverviewPage() {
  const ov = useAsync(api.overview, [], 10000);
  const signals = useAsync(() => api.signals(), [], 15000);
  const intake = useIntake();
  const [resetting, setResetting] = useState(false);
  useEventStream("/api/events", (e: F2FEvent) => {
    intake.onEvent(e);
    if (e.type.startsWith("case.") || e.type === "signal.created" || e.type === "demo.reset") ov.reload();
    if (e.type === "signal.created" || e.type === "demo.reset") signals.reload();
  });

  const reset = async () => {
    setResetting(true);
    try {
      await api.resetDemo();
      ov.reload();
    } finally {
      setResetting(false);
    }
  };

  const d = ov.data;
  const loading = ov.loading && !d;
  return (
    <PageBody>
      <PageHeader
        title="Overview"
        description="Field signals in, verified OTAs out. Every number is traceable to a case and its evidence."
        actions={
          <Button size="sm" variant="secondary" onClick={reset} disabled={resetting}>
            <RotateCcw size={13} />
            Reset demo data
          </Button>
        }
      />
      {ov.error && !d && (
        <div className="mb-6">
          <ErrorState error={ov.error} onRetry={ov.reload} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Radio} tone="accent" loading={loading} value={d?.kpis.signals_24h} label="signals in the last 24 hours" sub="from every intake channel" />
        <StatCard icon={FolderKanban} tone="info" loading={loading} value={d?.kpis.open_cases} label="open cases" sub={d ? `${d.kpis.closed_cases} closed` : ""} />
        <StatCard
          icon={Car}
          tone="ok"
          loading={loading}
          value={d?.kpis.vehicles_fixed}
          label="vehicles fixed"
          sub={d ? `of ${d.kpis.vehicles_affected} affected${d.kpis.vehicles_affected ? ` · ${Math.round((d.kpis.vehicles_fixed / d.kpis.vehicles_affected) * 100)}%` : ""}` : ""}
        />
        <StatCard
          icon={Timer}
          tone="warn"
          loading={loading}
          value={d?.kpis.mttr_minutes != null ? `${d.kpis.mttr_minutes.toFixed(d.kpis.mttr_minutes < 10 ? 1 : 0)} min` : "—"}
          label="median time to fix"
          sub="complaint to verified OTA"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader icon={ChartPie} title="Signals by source" description="Share of all normalized signals per intake channel" />
          <CardBody className="flex flex-1 items-center">{d ? <div className="w-full"><SourceDonut data={d} /></div> : <Skeleton className="h-[220px] w-full" />}</CardBody>
        </Card>
        <Card className="flex flex-col">
          <CardHeader
            icon={Activity}
            title="Recent activity"
            description="What the agents did, newest first"
            action={<Link to="/signals" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">View all <ArrowUpRight size={13} /></Link>}
          />
          <RecentActivity items={intake.data?.activity} signals={signals.data} cases={d?.cases} />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader icon={TriangleAlert} title="Severity breakdown" description="Triaged signals by severity" />
          <CardBody>{signals.data ? <SeverityChart signals={signals.data} /> : <Skeleton className="h-[220px]" />}</CardBody>
        </Card>
        <Card>
          <CardHeader icon={ChartColumn} title="Signal volume" description="Signals per source over the last 48 hours" />
          <CardBody>{d ? <Timeline data={d} /> : <Skeleton className="h-[220px]" />}</CardBody>
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader
          icon={FolderKanban}
          title="Cases"
          description="Pipelines started from clustered field signals"
          action={<Link to="/cases" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">View all <ArrowUpRight size={13} /></Link>}
        />
        <CasesTable data={d} loading={loading} />
      </Card>
    </PageBody>
  );
}

const TONES = {
  accent: "bg-accent/10 text-accent",
  info: "bg-info/10 text-info",
  ok: "bg-ok/10 text-ok",
  warn: "bg-warn/10 text-warn",
};

/** Jira summary card: tinted icon, one number, what it counts. */
function StatCard({ icon: Icon, tone, value, label, sub, loading }: { icon: LucideIcon; tone: keyof typeof TONES; value: React.ReactNode; label: string; sub?: string; loading: boolean }) {
  return (
    <div className="panel flex items-center gap-4 p-4">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", TONES[tone])}>
        <Icon size={20} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        {loading ? <Skeleton className="h-7 w-16" /> : <div className="tnum text-2xl font-semibold leading-7 text-fg">{value ?? "—"}</div>}
        <div className="truncate text-sm text-muted">{label}</div>
        {sub && <div className="truncate text-xs text-faint">{sub}</div>}
      </div>
    </div>
  );
}

function SourceDonut({ data }: { data: Overview }) {
  const rows = [...data.signals_by_source].sort((a, b) => b.count - a.count);
  const total = rows.reduce((a, b) => a + b.count, 0);
  if (!total) return <Empty title="No signals yet" className="h-[220px]" />;
  return (
    <div className="flex items-center gap-8">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <PieChart width={200} height={200}>
          <Pie data={rows} dataKey="count" nameKey="source" innerRadius={64} outerRadius={92} paddingAngle={rows.length > 1 ? 1.5 : 0} stroke="none" isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.source} fill={SOURCE_META[r.source]?.color ?? "#8590A2"} />)}
          </Pie>
          <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [v, SOURCE_META[n as keyof typeof SOURCE_META]?.label ?? n]} />
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-3xl font-semibold leading-8">{total}</span>
          <span className="text-xs text-faint">total signals</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-2.5">
        {rows.map((r) => {
          const m = SOURCE_META[r.source];
          return (
            <li key={r.source} className="flex items-center gap-2.5 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: m?.color }} />
              <span className="min-w-0 flex-1 truncate">{m?.label ?? r.source}</span>
              <span className="tnum font-medium">{r.count}</span>
              <span className="tnum w-10 text-right text-xs text-faint">{Math.round((r.count / total) * 100)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Row = { id: string; ts: number; actor: string; text: string; source?: Signal["source"]; caseId?: string | null };

const CASE_VERB: Record<string, string> = {
  closed: "closed", running: "is running", awaiting_approval: "is waiting for approval", releasing: "is releasing", failed: "failed", open: "was opened",
};

/** Jira-style activity stream: agent actions, newly received reports and case changes, newest first. */
function RecentActivity({ items, signals, cases }: { items?: IntakeActivity[]; signals?: Signal[]; cases?: Case[] }) {
  if (!items && !signals) return <div className="space-y-3 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>;
  const agent: Row[] = (items ?? [])
    .filter((a) => a.kind !== "check")
    .map((a) => ({ id: `a${a.id}`, ts: a.ts, actor: a.kind === "case" ? "Pipeline" : "Intake agent", text: a.text.charAt(0).toLowerCase() + a.text.slice(1), source: a.source ?? undefined, caseId: a.case_id }));
  const received: Row[] = (signals ?? []).map((s) => ({ id: `s${s.id}`, ts: s.created_at, actor: SOURCE_META[s.source]?.label ?? s.source, text: `reported “${s.title}”`, source: s.source, caseId: s.case_id }));
  const changed: Row[] = (cases ?? []).map((c) => ({ id: `c${c.id}${c.updated_at}`, ts: c.updated_at, actor: c.id, text: `${CASE_VERB[c.status] ?? c.status} · ${c.title}`, caseId: c.id }));
  // Repeated identical reports (a device firing the same rule) collapse into one row with a count.
  const rows: (Row & { n: number })[] = [];
  for (const r of [...agent, ...received, ...changed].sort((a, b) => b.ts - a.ts)) {
    const same = rows.find((x) => x.actor === r.actor && x.text === r.text);
    if (same) same.n += 1;
    else if (rows.length < 6) rows.push({ ...r, n: 1 });
  }
  if (!rows.length) return <Empty title="No recent activity" hint="Agent actions appear here as signals arrive." className="flex-1" />;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const meta = r.source ? SOURCE_META[r.source] : undefined;
        const Icon = meta?.icon ?? FolderKanban;
        const color = meta?.color ?? "#1F845A";
        return (
          <li key={r.id} className="flex gap-3 px-4 py-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: `${color}1f`, color }}>
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm leading-5 text-fg">
                <span className="font-semibold">{r.actor}</span> <span className="text-muted">{r.text}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-2 text-xs text-faint">
                {r.caseId && r.actor !== r.caseId && <IssueKey id={r.caseId} className="text-xs" />}
                <span className="tnum">{timeAgo(r.ts)}</span>
                {r.n > 1 && <span className="tnum rounded-full bg-fg/[0.08] px-1.5 font-semibold text-muted">×{r.n}</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const SEV_ORDER = ["critical", "high", "medium", "low"];

function SeverityChart({ signals }: { signals: Signal[] }) {
  const rows = SEV_ORDER.map((k) => ({ key: k, name: SEVERITY[k].label, count: signals.filter((s) => s.severity === k).length }));
  if (!rows.some((r) => r.count)) return <Empty title="No triaged signals yet" className="h-[220px]" />;
  return (
    <div className="flex gap-6">
      <div className="h-[220px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap="28%">
            {grid}
            <XAxis dataKey="name" {...axis} />
            <YAxis {...axis} axisLine={false} allowDecimals={false} />
            <Tooltip {...tooltipProps} />
            <Bar dataKey="count" name="Signals" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.key} fill={SEVERITY[r.key].color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-36 shrink-0 space-y-3 self-center">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between text-sm">
            <SeverityBadge severity={r.key} />
            <span className="tnum font-medium">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Timeline({ data }: { data: Overview }) {
  const rows = useMemo(
    () => data.signals_timeline.map((r) => ({ ...r, label: new Date(r.t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) })),
    [data.signals_timeline],
  );
  if (!rows.length) return <Empty title="No signals yet" hint="Crawlers and hu-sentinel devices will populate this chart." className="h-[220px]" />;
  const active = SOURCES.filter((s) => rows.some((r) => (r[s] ?? 0) > 0));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 8, right: 4, left: -20, bottom: 0 }} barCategoryGap={3}>
        {grid}
        <XAxis dataKey="label" {...axis} minTickGap={32} />
        <YAxis {...axis} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipProps} />
        {active.map((s, i) => (
          <Bar key={s} dataKey={s} name={SOURCE_META[s].label} stackId="1" fill={SOURCE_META[s].color} radius={i === active.length - 1 ? [3, 3, 0, 0] : undefined} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function CasesTable({ data, loading }: { data?: Overview; loading: boolean }) {
  const { stages } = useApp();
  if (loading) return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>;
  if (!data?.cases.length) return <Empty title="No cases yet" hint="A case opens automatically when a signal cluster crosses its threshold, or when you promote a cluster from Signals." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Key</Th>
          <Th>Summary</Th>
          <Th>Status</Th>
          <Th>Priority</Th>
          <Th>Pipeline</Th>
          <Th className="text-right">Fixed / affected</Th>
          <Th className="text-right">Updated</Th>
        </tr>
      </thead>
      <tbody>
        {data.cases.map((c) => (
          <Tr key={c.id}>
            <Td><IssueKey id={c.id} /></Td>
            <Td className="w-full max-w-0">
              <Link to={`/cases/${c.id}`} className="block truncate text-sm hover:text-accent">{c.title}</Link>
            </Td>
            <Td><CaseStatusChip status={c.status} /></Td>
            <Td><SeverityBadge severity={c.severity} /></Td>
            <Td><StageStrip stages={stages} runs={inferStageStatuses(stages, c.current_stage, c.status)} /></Td>
            <Td className="tnum whitespace-nowrap text-right"><span className={c.fixed_vins ? "text-ok" : "text-faint"}>{c.fixed_vins}</span><span className="text-faint"> / {c.affected_vins}</span></Td>
            <Td className="tnum whitespace-nowrap text-right text-xs text-faint">{timeAgo(c.updated_at)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

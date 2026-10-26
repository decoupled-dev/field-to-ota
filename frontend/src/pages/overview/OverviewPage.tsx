import { Link } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { api, type Overview } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, SeverityBadge, SOURCE_META, SOURCES, StageStrip, inferStageStatuses } from "@/components/domain";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, axis, grid, legend, tooltipProps } from "@/components/charts";
import { timeAgo } from "@/lib/utils";
import { useState } from "react";

export default function OverviewPage() {
  const ov = useAsync(api.overview, [], 10000);
  const [resetting, setResetting] = useState(false);
  useEventStream("/api/events", (e) => {
    if (e.type.startsWith("case.") || e.type === "signal.created") ov.reload();
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

  return (
    <PageBody>
      <PageHeader
        title="Overview"
        description="Field signals, active fix pipelines and fleet impact across all programs."
        actions={
          <Button size="sm" variant="secondary" onClick={reset} disabled={resetting}>
            <RotateCcw size={13} />
            Reset demo data
          </Button>
        }
      />
      {ov.error && !ov.data && (
        <div className="mb-6">
          <ErrorState error={ov.error} onRetry={ov.reload} />
        </div>
      )}
      <Kpis data={ov.data} loading={ov.loading && !ov.data} />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Signal volume" description="Normalized signals per source over time" />
          <CardBody>{ov.data ? <Timeline data={ov.data} /> : ov.error ? <Empty title="No data" className="h-[240px]" /> : <Skeleton className="h-[240px]" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Signals by source" description="All intake channels" />
          <CardBody>{ov.data ? <SourceBreakdown data={ov.data} /> : ov.error ? <Empty title="No data" className="h-[240px]" /> : <Skeleton className="h-[240px]" />}</CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Active cases" description="Pipelines started from clustered field signals" action={<Link to="/cases" className="text-xs font-medium text-accent hover:underline">View all</Link>} />
        <CasesTable data={ov.data} loading={ov.loading && !ov.data} />
      </Card>
    </PageBody>
  );
}

function Kpis({ data, loading }: { data?: Overview; loading: boolean }) {
  const k = data?.kpis;
  const tiles = [
    { label: "Open cases", value: k?.open_cases, sub: k ? `${k.closed_cases} closed` : "" },
    { label: "MTTR complaint → OTA", value: k?.mttr_minutes != null ? `${k.mttr_minutes.toFixed(k.mttr_minutes < 10 ? 1 : 0)} min` : "—", sub: "median, closed cases" },
    { label: "Vehicles affected", value: k?.vehicles_affected, sub: "matched fleet signature" },
    { label: "Vehicles fixed", value: k?.vehicles_fixed, sub: k && k.vehicles_affected ? `${Math.round((k.vehicles_fixed / k.vehicles_affected) * 100)}% of affected` : "post-OTA healthy" },
    { label: "Signals, 24h", value: k?.signals_24h, sub: "all sources" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="bg-surface px-4 py-3.5">
          <div className="text-xs text-muted">{t.label}</div>
          {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <div className="tnum mt-1 text-2xl font-semibold tracking-tight">{t.value ?? "—"}</div>}
          <div className="mt-0.5 text-xs text-muted">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function Timeline({ data }: { data: Overview }) {
  if (!data.signals_timeline.length) return <Empty title="No signals yet" hint="Crawlers and hu-sentinel devices will populate this chart." className="h-[240px]" />;
  const rows = data.signals_timeline.map((r) => ({ ...r, label: new Date(r.t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) }));
  const active = SOURCES.filter((s) => rows.some((r) => (r[s] ?? 0) > 0));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={rows} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        {grid}
        <XAxis dataKey="label" {...axis} minTickGap={32} />
        <YAxis {...axis} axisLine={false} allowDecimals={false} />
        <Tooltip {...tooltipProps} />
        {legend}
        {active.map((s) => (
          <Area key={s} type="monotone" dataKey={s} name={SOURCE_META[s].label} stackId="1" stroke={SOURCE_META[s].color} fill={SOURCE_META[s].color} fillOpacity={0.18} strokeWidth={1.5} isAnimationActive={false} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

function SourceBreakdown({ data }: { data: Overview }) {
  const total = data.signals_by_source.reduce((a, b) => a + b.count, 0);
  if (!total) return <Empty title="No signals yet" className="h-[240px]" />;
  const rows = [...data.signals_by_source].sort((a, b) => b.count - a.count);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const m = SOURCE_META[r.source];
        const pct = (r.count / total) * 100;
        return (
          <div key={r.source}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="font-medium">{m?.label ?? r.source}</span>
              <span className="tnum text-muted">
                {r.count} <span className="ml-1">{pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-subtle">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: m?.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CasesTable({ data, loading }: { data?: Overview; loading: boolean }) {
  const { stages } = useApp();
  if (loading) return <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>;
  if (!data?.cases.length) return <Empty title="No cases yet" hint="A case opens automatically when a signal cluster crosses its threshold, or when you promote a cluster from Signals." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Case</Th>
          <Th>Title</Th>
          <Th>Status</Th>
          <Th>Severity</Th>
          <Th>Pipeline</Th>
          <Th className="text-right">Affected</Th>
          <Th className="text-right">Updated</Th>
        </tr>
      </thead>
      <tbody>
        {data.cases.map((c) => (
          <Tr key={c.id}>
            <Td className="font-mono text-xs">
              <Link to={`/cases/${c.id}`} className="text-accent hover:underline">{c.id}</Link>
            </Td>
            <Td className="max-w-[420px] truncate font-medium">
              <Link to={`/cases/${c.id}`} className="hover:underline">{c.title}</Link>
            </Td>
            <Td><CaseStatusChip status={c.status} /></Td>
            <Td><SeverityBadge severity={c.severity} /></Td>
            <Td><StageStrip stages={stages} runs={inferStageStatuses(stages, c.current_stage, c.status)} /></Td>
            <Td className="tnum text-right">{c.affected_vins}</Td>
            <Td className="text-right text-xs text-muted">{timeAgo(c.updated_at)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

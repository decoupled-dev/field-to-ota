import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, ChevronRight, RotateCcw } from "lucide-react";
import { api, type Overview } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, SeverityBadge, SOURCE_META, SOURCES, StageStrip, inferStageStatuses } from "@/components/domain";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, axis, grid, tooltipProps } from "@/components/charts";
import { cn, timeAgo } from "@/lib/utils";

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
        eyebrow="Operations · all programs"
        title="Overview"
        description="Field signals in, verified OTAs out. Every number below is traceable to a case and its evidence pack."
        actions={
          <Button size="sm" variant="ghost" onClick={reset} disabled={resetting}>
            <RotateCcw size={12} />
            Reset demo data
          </Button>
        }
      />
      {ov.error && !ov.data && (
        <div className="mb-6">
          <ErrorState error={ov.error} onRetry={ov.reload} />
        </div>
      )}
      <Funnel data={ov.data} loading={ov.loading && !ov.data} />
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Signal volume" description="Normalized signals per source over time" />
          <CardBody>{ov.data ? <Timeline data={ov.data} /> : ov.error ? <Empty title="No data" className="h-[240px]" /> : <Skeleton className="h-[240px]" />}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Intake channels" description="Share of all signals" />
          <CardBody>{ov.data ? <SourceBreakdown data={ov.data} /> : ov.error ? <Empty title="No data" className="h-[240px]" /> : <Skeleton className="h-[240px]" />}</CardBody>
        </Card>
      </div>
      <Card className="mt-5">
        <CardHeader
          title="Cases"
          description="Pipelines started from clustered field signals"
          action={<Link to="/cases" className="inline-flex items-center gap-1 font-mono text-2xs uppercase tracking-[0.06em] text-muted hover:text-accent">All cases <ArrowUpRight size={11} /></Link>}
        />
        <CasesTable data={ov.data} loading={ov.loading && !ov.data} />
      </Card>
    </PageBody>
  );
}

/** The loop as a funnel: what came in, what we opened, who is affected, who is fixed, and how fast. */
function Funnel({ data, loading }: { data?: Overview; loading: boolean }) {
  const k = data?.kpis;
  const steps: { label: string; value: React.ReactNode; sub: string; tone?: string }[] = [
    { label: "Signals · 24h", value: k?.signals_24h, sub: "all intake channels" },
    { label: "Open cases", value: k?.open_cases, sub: k ? `${k.closed_cases} closed` : "", tone: k?.open_cases ? "text-run" : undefined },
    { label: "Vehicles affected", value: k?.vehicles_affected, sub: "matched fleet signature" },
    {
      label: "Vehicles fixed",
      value: k?.vehicles_fixed,
      sub: k && k.vehicles_affected ? `${Math.round((k.vehicles_fixed / k.vehicles_affected) * 100)}% of affected` : "post-OTA healthy",
      tone: "text-ok",
    },
  ];
  const mttr = k?.mttr_minutes;
  return (
    <div className="panel grid overflow-hidden md:grid-cols-[repeat(4,minmax(0,1fr))_minmax(240px,0.9fr)]">
      {steps.map((s, i) => (
        <div key={s.label} className={cn("relative px-5 py-5", i > 0 && "border-t border-border md:border-l md:border-t-0")}>
          {i > 0 && (
            <span className="absolute -left-[9px] top-1/2 z-10 hidden h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface text-faint md:flex">
              <ChevronRight size={11} />
            </span>
          )}
          <div className="label flex items-center gap-2">
            <span className="text-faint">{String(i + 1).padStart(2, "0")}</span>
            {s.label}
          </div>
          {loading ? <Skeleton className="mt-3 h-10 w-20" /> : <div className={cn("tnum mt-2 text-[42px] font-light leading-none tracking-[-0.045em]", s.tone)}>{s.value ?? "—"}</div>}
          <div className="mt-2.5 font-mono text-2xs uppercase tracking-[0.05em] text-faint">{s.sub}</div>
        </div>
      ))}
      <div className="relative border-t border-border bg-accent/[0.06] px-5 py-5 md:border-l md:border-t-0 md:border-l-accent/30">
        <div className="label text-accent">MTTR · complaint → OTA</div>
        {loading ? (
          <Skeleton className="mt-3 h-10 w-24" />
        ) : (
          <div className="tnum mt-2 text-[42px] font-light leading-none tracking-[-0.045em]">
            {mttr != null ? mttr.toFixed(mttr < 10 ? 1 : 0) : "—"}
            <span className="ml-1 text-[18px] font-normal tracking-normal text-muted">min</span>
          </div>
        )}
        <div className="mt-2.5 font-mono text-2xs uppercase tracking-[0.05em] text-faint">median over closed cases</div>
      </div>
    </div>
  );
}

function Timeline({ data }: { data: Overview }) {
  if (!data.signals_timeline.length) return <Empty title="No signals yet" hint="Crawlers and hu-sentinel devices will populate this chart." className="h-[240px]" />;
  const rows = data.signals_timeline.map((r) => ({ ...r, label: new Date(r.t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }) }));
  const active = SOURCES.filter((s) => rows.some((r) => (r[s] ?? 0) > 0));
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        {active.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 font-mono text-2xs uppercase tracking-[0.05em] text-muted">
            <span className="h-2 w-2 rounded-[1px]" style={{ background: SOURCE_META[s].color }} />
            {SOURCE_META[s].label}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={rows} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
          {grid}
          <XAxis dataKey="label" {...axis} minTickGap={32} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip {...tooltipProps} />
          {active.map((s, i) => (
            <Bar key={s} dataKey={s} name={SOURCE_META[s].label} stackId="1" fill={SOURCE_META[s].color} radius={i === active.length - 1 ? [1, 1, 0, 0] : undefined} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function SourceBreakdown({ data }: { data: Overview }) {
  const total = data.signals_by_source.reduce((a, b) => a + b.count, 0);
  if (!total) return <Empty title="No signals yet" className="h-[240px]" />;
  const rows = [...data.signals_by_source].sort((a, b) => b.count - a.count);
  return (
    <div>
      <div className="mb-5 flex h-2 overflow-hidden rounded-[1px]">
        {rows.map((r) => (
          <span key={r.source} style={{ width: `${(r.count / total) * 100}%`, background: SOURCE_META[r.source]?.color }} className="border-r border-surface last:border-0" />
        ))}
      </div>
      <ul className="space-y-2.5">
        {rows.map((r) => {
          const m = SOURCE_META[r.source];
          const pct = (r.count / total) * 100;
          return (
            <li key={r.source} className="grid grid-cols-[1fr_auto_44px] items-center gap-3">
              <span className="flex min-w-0 items-center gap-2 text-[13px]">
                <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ background: m?.color }} />
                <span className="truncate">{m?.label ?? r.source}</span>
              </span>
              <span className="tnum font-mono text-[12px]">{r.count}</span>
              <span className="tnum text-right font-mono text-2xs text-faint">{pct.toFixed(0)}%</span>
            </li>
          );
        })}
      </ul>
    </div>
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
          <Th>Case</Th>
          <Th>Title</Th>
          <Th>Status</Th>
          <Th>Severity</Th>
          <Th>Pipeline</Th>
          <Th className="text-right">Affected</Th>
          <Th className="text-right">Fixed</Th>
          <Th className="text-right">Updated</Th>
        </tr>
      </thead>
      <tbody>
        {data.cases.map((c) => (
          <Tr key={c.id}>
            <Td className="font-mono text-[12px]">
              <Link to={`/cases/${c.id}`} className="hover:text-accent">{c.id}</Link>
            </Td>
            <Td className="max-w-[440px] truncate text-[13px] font-medium">
              <Link to={`/cases/${c.id}`} className="hover:text-accent">{c.title}</Link>
            </Td>
            <Td><CaseStatusChip status={c.status} /></Td>
            <Td><SeverityBadge severity={c.severity} /></Td>
            <Td><StageStrip stages={stages} runs={inferStageStatuses(stages, c.current_stage, c.status)} /></Td>
            <Td className="tnum text-right font-mono text-[12.5px]">{c.affected_vins}</Td>
            <Td className={cn("tnum text-right font-mono text-[12.5px]", c.fixed_vins ? "text-ok" : "text-faint")}>{c.fixed_vins}</Td>
            <Td className="tnum whitespace-nowrap text-right font-mono text-2xs text-faint">{timeAgo(c.updated_at)}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}

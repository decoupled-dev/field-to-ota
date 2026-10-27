import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Clock, FolderOpen, Layers, ListChecks, Package, Search, Tag, Users, X } from "lucide-react";
import { api, type Cluster, type Signal } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { SeverityBadge, SOURCE_META, SourceBadge } from "@/components/domain";
import { AgentFeed, SourceBoard, useIntake } from "./IntakeBoard";
import { cn, fmtTime, humanize, timeAgo } from "@/lib/utils";

export default function SignalsPage() {
  const signals = useAsync(() => api.signals(), [], 15000);
  const clusters = useAsync(api.clusters, [], 15000);
  const intake = useIntake();
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Signal | null>(null);
  const [arrived, setArrived] = useState<Set<string>>(new Set());

  const live = useEventStream("/api/events", (e) => {
    intake.onEvent(e);
    if (e.type === "signal.created" && e.data.signal) {
      const s = e.data.signal as Signal;
      signals.setData((prev) => (prev ? [s, ...prev.filter((p) => p.id !== s.id)] : [s]));
      setArrived((a) => new Set(a).add(s.id));
    }
    if (e.type === "cluster.updated" || e.type === "case.created") clusters.reload();
    if (e.type === "demo.reset") signals.reload();
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (signals.data ?? []).filter(
      (s) => (!source || s.source === source) && (!needle || `${s.title} ${s.body} ${s.component ?? ""} ${s.vin ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [signals.data, source, q]);

  return (
    <PageBody>
      <PageHeader
        title="Signals"
        description="Every intake channel the agent watches, what it is checking right now, and every report it has normalized and triaged."
      />
      <SourceBoard sources={intake.data?.sources} checkingUntil={intake.checkingUntil} selected={source} onSelect={setSource} />
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="h-fit min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded bg-accent/10 text-accent"><ListChecks size={14} strokeWidth={2.25} /></span>
              Reports
            </h3>
            {source && (
              <button onClick={() => setSource("")} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-accent/10 pl-2 pr-1.5 text-xs font-medium text-accent hover:bg-accent/15">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_META[source as keyof typeof SOURCE_META]?.color }} />
                {SOURCE_META[source as keyof typeof SOURCE_META]?.label ?? source}
                <X size={12} />
              </button>
            )}
            <span className="tnum text-xs text-faint">{rows.length} shown</span>
            <div className="relative ml-auto w-64">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, body, component, VIN" className="pl-8" />
            </div>
          </div>
          {signals.error && !signals.data ? (
            <div className="p-4"><ErrorState error={signals.error} onRetry={signals.reload} /></div>
          ) : signals.loading && !signals.data ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !rows.length ? (
            <Empty title="No signals match" hint="Signals appear here as crawlers and devices report them." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Source</Th>
                  <Th>Observation</Th>
                  <Th>Severity</Th>
                  <Th>Case</Th>
                  <Th className="text-right">Received</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id} className={cn("cursor-pointer", arrived.has(s.id) && "animate-flash")} onClick={() => setOpen(s)}>
                    <Td><SourceBadge source={s.source} /></Td>
                    <Td className="w-full max-w-0">
                      <div className="truncate text-[13px] font-medium">{s.title}</div>
                    </Td>
                    <Td><SeverityBadge severity={s.severity} /></Td>
                    <Td className="whitespace-nowrap font-mono text-[12px]">
                      {s.case_id ? (
                        <Link to={`/cases/${s.case_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-accent hover:underline"><FolderOpen size={12} />{s.case_id}</Link>
                      ) : <span className="text-faint">—</span>}
                    </Td>
                    <Td className="tnum whitespace-nowrap text-right text-xs text-faint">{timeAgo(s.created_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <div className="space-y-5">
          <AgentFeed intake={intake.data} checkingUntil={intake.checkingUntil} live={live} />
          <ClustersPanel clusters={clusters.data} loading={clusters.loading && !clusters.data} error={clusters.error} onChange={clusters.reload} />
        </div>
      </div>
      <SignalSheet signal={open} onClose={() => setOpen(null)} />
    </PageBody>
  );
}

/** Threshold as discrete cells: one cell per reporter needed to open a case. */
function ThresholdGauge({ score, threshold, crossed }: { score: number; threshold: number; crossed: boolean }) {
  const cells = Math.max(1, Math.min(12, Math.round(threshold)));
  const filled = (score / Math.max(1, threshold)) * cells;
  return (
    <div className="flex flex-1 gap-[3px]">
      {Array.from({ length: cells }, (_, i) => {
        const part = Math.max(0, Math.min(1, filled - i));
        return (
          <span key={i} className="relative h-2.5 flex-1 overflow-hidden rounded-[1px] bg-subtle">
            <span className={cn("absolute inset-y-0 left-0", crossed ? "bg-ok" : "bg-accent")} style={{ width: `${part * 100}%` }} />
          </span>
        );
      })}
    </div>
  );
}

function ClustersPanel({ clusters, loading, error, onChange }: { clusters?: Cluster[]; loading: boolean; error?: Error; onChange: () => void }) {
  const nav = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const promote = async (id: string) => {
    setBusy(id);
    try {
      const c = await api.promote(id);
      onChange();
      nav(`/cases/${c.id}`);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card className="h-fit">
      <CardHeader icon={Layers} title="Clusters" description="Semantically similar signals. A cluster opens a case on its own once it crosses the reporter threshold." />
      {error && !clusters ? (
        <div className="p-4"><ErrorState error={error} onRetry={onChange} /></div>
      ) : loading ? (
        <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !clusters?.length ? (
        <Empty title="No clusters yet" />
      ) : (
        <ul className="divide-y divide-border">
          {clusters.map((c) => {
            // Cases trigger on independent reporters (backend cluster.should_trigger), not on similarity score.
            const crossed = !!c.case_id || c.authors >= c.threshold;
            return (
              <li key={c.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5">{c.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                      <span className="inline-flex items-center gap-1"><Tag size={11} />{c.component ?? "Unclassified"}</span>
                      {c.sw_version && <span className="inline-flex items-center gap-1 font-mono"><Package size={11} />{c.sw_version}</span>}
                      <span className="inline-flex items-center gap-1"><Users size={11} />{c.authors}</span>
                      <span className="inline-flex items-center gap-1"><Clock size={11} />{timeAgo(c.last_seen)}</span>
                    </div>
                  </div>
                  {c.case_id ? (
                    <Link to={`/cases/${c.case_id}`} className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] text-accent hover:underline">
                      <FolderOpen size={12} />
                      {c.case_id}
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => promote(c.id)}>Promote</Button>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <ThresholdGauge score={c.authors} threshold={c.threshold} crossed={crossed} />
                  <span className={cn("tnum shrink-0 font-mono text-[12px]", crossed ? "text-ok" : "text-fg")}>
                    {c.authors}<span className="text-faint">/{c.threshold} reporters</span>
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
                  {Object.entries(c.sources).map(([s, n]) => (
                    <span key={s} className="inline-flex items-center gap-1.5 text-xs text-muted">
                      <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: SOURCE_META[s as keyof typeof SOURCE_META]?.color }} />
                      {SOURCE_META[s as keyof typeof SOURCE_META]?.label ?? s} <span className="tnum text-fg">{n}</span>
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SignalSheet({ signal, onClose }: { signal: Signal | null; onClose: () => void }) {
  const s = signal;
  const fields: [string, React.ReactNode][] = s
    ? [
        ["Source", <SourceBadge source={s.source} />],
        ["Received", <span className="font-mono text-[12px]">{fmtTime(s.created_at)}</span>],
        ["Author", s.author ?? "—"],
        ["Component", <span className="font-mono text-[12px]">{s.component ?? "—"}</span>],
        ["SW version", <span className="font-mono text-[12px]">{s.sw_version ?? "—"}</span>],
        ["Vehicle model", s.vehicle_model ?? "—"],
        ["Severity", <SeverityBadge severity={s.severity} />],
        ["Classified as bug", s.is_bug == null ? "—" : s.is_bug ? "Yes" : "No"],
        ["Cluster", <span className="font-mono text-[12px]">{s.cluster_id ?? "—"}</span>],
        ["Case", s.case_id ? <Link to={`/cases/${s.case_id}`} className="font-mono text-[12px] text-accent hover:underline">{s.case_id}</Link> : "—"],
        ...(s.vin ? ([["VIN", <span className="font-mono text-[12px]">{s.vin}</span>]] as [string, React.ReactNode][]) : []),
        ...(s.rule_id ? ([["Rule", <span className="font-mono text-[12px]">{s.rule_id}</span>]] as [string, React.ReactNode][]) : []),
      ]
    : [];
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()} eyebrow={s ? SOURCE_META[s.source]?.label ?? s.source : undefined} title={s?.title ?? ""} description={s?.id}>
      {s && (
        <div className="space-y-6 p-5">
          {s.url && (
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
              Open original <ArrowUpRight size={11} />
            </a>
          )}
          {s.body && <blockquote className="whitespace-pre-wrap border-l-2 border-strong pl-4 text-[13.5px] leading-6 text-fg/90">{s.body}</blockquote>}
          <dl className="divide-y divide-border overflow-hidden rounded border border-border">
            {fields.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[150px_1fr] items-center gap-4 px-3 py-2">
                <dt className="text-xs text-faint">{k}</dt>
                <dd className="min-w-0 break-words text-[13px]">{v}</dd>
              </div>
            ))}
          </dl>
          {s.conditions.length > 0 && (
            <div>
              <div className="label mb-2">Conditions</div>
              <div className="flex flex-wrap gap-1.5">
                {s.conditions.map((c) => <span key={c} className="rounded-sm border border-border bg-raised px-1.5 py-0.5 font-mono text-2xs">{c}</span>)}
              </div>
            </div>
          )}
          {Object.keys(s.metrics).length > 0 && (
            <div>
              <div className="label mb-2">Device metrics</div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border">
                {Object.entries(s.metrics).map(([k, v]) => (
                  <div key={k} className="bg-surface px-3 py-2.5">
                    <dt className="label">{humanize(k)}</dt>
                    <dd className="tnum mt-1 font-mono text-[15px]">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

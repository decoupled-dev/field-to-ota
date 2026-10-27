import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { api, type Cluster, type Signal } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { SeverityBadge, SOURCE_META, SOURCES, SourceBadge } from "@/components/domain";
import { cn, fmtTime, humanize, timeAgo } from "@/lib/utils";

export default function SignalsPage() {
  const signals = useAsync(() => api.signals(), [], 15000);
  const clusters = useAsync(api.clusters, [], 15000);
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Signal | null>(null);

  useEventStream("/api/events", (e) => {
    if (e.type === "signal.created" && e.data.signal) {
      const s = e.data.signal as Signal;
      signals.setData((prev) => (prev ? [s, ...prev.filter((p) => p.id !== s.id)] : [s]));
    }
    if (e.type === "cluster.updated" || e.type === "case.created") clusters.reload();
  });

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (signals.data ?? []).filter(
      (s) => (!source || s.source === source) && (!needle || `${s.title} ${s.body} ${s.component ?? ""} ${s.vin ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [signals.data, source, q]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    (signals.data ?? []).forEach((s) => (m[s.source] = (m[s.source] ?? 0) + 1));
    return m;
  }, [signals.data]);

  return (
    <PageBody>
      <PageHeader
        title="Signals"
        description="Every observation from social channels, public trackers and in-vehicle hu-sentinel daemons, normalized and triaged into one schema."
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="h-fit min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <div className="relative w-72">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, body, component, VIN" className="pl-8" />
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <SourceFilter active={!source} onClick={() => setSource("")} label="All" n={signals.data?.length ?? 0} />
              {SOURCES.filter((s) => counts[s]).map((s) => (
                <SourceFilter key={s} active={source === s} onClick={() => setSource(s)} label={SOURCE_META[s].label} n={counts[s]} color={SOURCE_META[s].color} />
              ))}
            </div>
            <span className="tnum ml-auto text-xs text-faint">{rows.length} shown</span>
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
                  <Tr key={s.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                    <Td><SourceBadge source={s.source} /></Td>
                    <Td className="w-full max-w-0">
                      <div className="truncate text-[13px] font-medium">{s.title}</div>
                    </Td>
                    <Td><SeverityBadge severity={s.severity} /></Td>
                    <Td className="whitespace-nowrap font-mono text-[12px]">
                      {s.case_id ? (
                        <Link to={`/cases/${s.case_id}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{s.case_id}</Link>
                      ) : <span className="text-faint">—</span>}
                    </Td>
                    <Td className="tnum whitespace-nowrap text-right text-xs text-faint">{timeAgo(s.created_at)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <ClustersPanel clusters={clusters.data} loading={clusters.loading && !clusters.data} error={clusters.error} onChange={clusters.reload} />
      </div>
      <SignalSheet signal={open} onClose={() => setOpen(null)} />
    </PageBody>
  );
}

function SourceFilter({ active, onClick, label, n, color }: { active: boolean; onClick: () => void; label: string; n: number; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs transition-colors",
        active ? "border-strong bg-raised text-fg" : "border-transparent text-muted hover:text-fg",
      )}
    >
      {color && <span className="h-1.5 w-1.5 rounded-[1px]" style={{ background: color }} />}
      {label}
      <span className="tnum text-faint">{n}</span>
    </button>
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
      <CardHeader title="Clusters" />
      <p className="border-b border-border px-4 py-2.5 text-xs leading-5 text-muted">Semantically similar signals. A cluster opens a case on its own once it crosses the reporter threshold.</p>
      {error && !clusters ? (
        <div className="p-4"><ErrorState error={error} onRetry={onChange} /></div>
      ) : loading ? (
        <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : !clusters?.length ? (
        <Empty title="No clusters yet" />
      ) : (
        <ul className="divide-y divide-border">
          {clusters.map((c) => {
            const crossed = c.score >= c.threshold;
            return (
              <li key={c.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium leading-5">{c.title}</div>
                    <div className="mt-1 text-xs text-faint">
                      {[c.component, c.sw_version].filter(Boolean).join(" · ") || "Unclassified"} · {c.authors} authors · {timeAgo(c.last_seen)}
                    </div>
                  </div>
                  {c.case_id ? (
                    <Link to={`/cases/${c.case_id}`} className="inline-flex shrink-0 items-center gap-1 font-mono text-[12px] text-accent hover:underline">
                      {c.case_id}
                      <ArrowUpRight size={11} />
                    </Link>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => promote(c.id)}>Promote</Button>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <ThresholdGauge score={c.score} threshold={c.threshold} crossed={crossed} />
                  <span className={cn("tnum shrink-0 font-mono text-[12px]", crossed ? "text-ok" : "text-fg")}>
                    {c.score.toFixed(c.score % 1 ? 1 : 0)}<span className="text-faint">/{c.threshold}</span>
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

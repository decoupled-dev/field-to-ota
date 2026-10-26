import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, Search } from "lucide-react";
import { api, type Cluster, type Signal } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
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

  return (
    <PageBody>
      <PageHeader title="Signals" description="Every observation from social channels, public trackers and in-vehicle hu-sentinel daemons, normalized and triaged." />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card className="h-fit min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="relative w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, body, component, VIN" className="pl-8" />
            </div>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">All sources</option>
              {SOURCES.map((s) => (
                <option key={s} value={s}>{SOURCE_META[s].label}</option>
              ))}
            </Select>
            <span className="tnum ml-auto text-xs text-muted">{rows.length} {rows.length === 1 ? "signal" : "signals"}</span>
          </div>
          {signals.error && !signals.data ? (
            <div className="p-4"><ErrorState error={signals.error} onRetry={signals.reload} /></div>
          ) : signals.loading && !signals.data ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-8" />)}</div>
          ) : !rows.length ? (
            <Empty title="No signals match" hint="Signals appear here as crawlers and devices report them." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Source</Th>
                  <Th>Title</Th>
                  <Th>Component</Th>
                  <Th>SW</Th>
                  <Th>Severity</Th>
                  <Th>Case</Th>
                  <Th className="text-right">Received</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id} className="cursor-pointer" onClick={() => setOpen(s)}>
                    <Td><SourceBadge source={s.source} /></Td>
                    <Td className="max-w-[380px]">
                      <div className="truncate font-medium">{s.title}</div>
                      <div className="truncate text-xs text-muted">{s.author ?? s.vin ?? ""}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{s.component ?? <span className="text-muted">—</span>}</Td>
                    <Td className="whitespace-nowrap font-mono text-xs">{s.sw_version ?? "—"}</Td>
                    <Td><SeverityBadge severity={s.severity} /></Td>
                    <Td className="whitespace-nowrap font-mono text-xs">
                      {s.case_id ? (
                        <Link to={`/cases/${s.case_id}`} onClick={(e) => e.stopPropagation()} className="text-accent hover:underline">{s.case_id}</Link>
                      ) : <span className="text-muted">—</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-xs text-muted">{timeAgo(s.created_at)}</Td>
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
      <CardHeader title="Clusters" description="Semantically similar signals. A cluster opens a case when it crosses its threshold." />
      {error && !clusters ? (
        <div className="p-4"><ErrorState error={error} onRetry={onChange} /></div>
      ) : loading ? (
        <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : !clusters?.length ? (
        <Empty title="No clusters yet" />
      ) : (
        <ul className="divide-y divide-border">
          {clusters.map((c) => {
            const pct = Math.min(100, (c.score / Math.max(1, c.threshold)) * 100);
            const crossed = c.score >= c.threshold;
            return (
              <li key={c.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-5">{c.title}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {[c.component, c.sw_version].filter(Boolean).join(" · ") || "Unclassified"} · {c.authors} authors · last {timeAgo(c.last_seen)}
                    </div>
                  </div>
                  {c.case_id ? (
                    <Link to={`/cases/${c.case_id}`} className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-accent hover:underline">
                      {c.case_id}
                      <ArrowUpRight size={12} />
                    </Link>
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => promote(c.id)}>Promote to case</Button>
                  )}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-subtle">
                    <div className={cn("h-full rounded-full", crossed ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="tnum text-xs text-muted">{c.score.toFixed(c.score % 1 ? 1 : 0)} / {c.threshold}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(c.sources).map(([s, n]) => (
                    <span key={s} className="inline-flex items-center gap-1 rounded bg-subtle px-1.5 py-0.5 text-[11px] text-muted">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: SOURCE_META[s as keyof typeof SOURCE_META]?.color }} />
                      {SOURCE_META[s as keyof typeof SOURCE_META]?.label ?? s} <span className="tnum font-medium text-fg">{n}</span>
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
        ["Received", fmtTime(s.created_at)],
        ["Author", s.author ?? "—"],
        ["Component", s.component ?? "—"],
        ["SW version", s.sw_version ?? "—"],
        ["Vehicle model", s.vehicle_model ?? "—"],
        ["Severity", <SeverityBadge severity={s.severity} />],
        ["Classified as bug", s.is_bug == null ? "—" : s.is_bug ? "Yes" : "No"],
        ["Cluster", s.cluster_id ?? "—"],
        ["Case", s.case_id ? <Link to={`/cases/${s.case_id}`} className="text-accent hover:underline">{s.case_id}</Link> : "—"],
        ...(s.vin ? ([["VIN", <span className="font-mono">{s.vin}</span>]] as [string, React.ReactNode][]) : []),
        ...(s.rule_id ? ([["Rule", <span className="font-mono">{s.rule_id}</span>]] as [string, React.ReactNode][]) : []),
      ]
    : [];
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()} title={s?.title ?? ""} description={s?.id}>
      {s && (
        <div className="space-y-5 p-5">
          {s.url && (
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              Open original <ArrowUpRight size={12} />
            </a>
          )}
          {s.body && <p className="whitespace-pre-wrap rounded border border-border bg-subtle/50 p-3 text-sm leading-6">{s.body}</p>}
          <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2.5 text-sm">
            {fields.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          {s.conditions.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">Conditions</div>
              <div className="flex flex-wrap gap-1">
                {s.conditions.map((c) => <span key={c} className="rounded border border-border px-1.5 py-0.5 text-xs">{c}</span>)}
              </div>
            </div>
          )}
          {Object.keys(s.metrics).length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted">Device metrics</div>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border text-sm">
                {Object.entries(s.metrics).map(([k, v]) => (
                  <div key={k} className="bg-surface px-3 py-2">
                    <dt className="text-xs text-muted">{humanize(k)}</dt>
                    <dd className="tnum font-medium">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
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

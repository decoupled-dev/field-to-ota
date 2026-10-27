import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Clock, Layers, Package, Search, Tag, Users } from "lucide-react";
import { api, type Cluster, type Signal } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { IssueKey, SeverityBadge, SOURCE_META, SourceBadge } from "@/components/domain";
import { AgentFeed, AgentStatus, SourceTabs, useIntake } from "./IntakeBoard";
import { cn, fmtTime, humanize, timeAgo } from "@/lib/utils";

type Group = { key: string; latest: Signal; count: number; title: string };

// A device firing the same rule repeatedly is one problem, not a hundred rows.
function groupSignals(list: Signal[]): Group[] {
  const by = new Map<string, Group>();
  for (const s of list) {
    const title = s.title.replace(/^hu-sentinel · /, "");
    const key = `${s.source}|${title}|${s.case_id ?? ""}`;
    const g = by.get(key);
    if (!g) by.set(key, { key, latest: s, count: 1, title });
    else {
      g.count += 1;
      if (s.created_at > g.latest.created_at) g.latest = s;
    }
  }
  return [...by.values()].sort((a, b) => b.latest.created_at - a.latest.created_at);
}

export default function SignalsPage() {
  const signals = useAsync(() => api.signals(), [], 15000);
  const clusters = useAsync(api.clusters, [], 15000);
  const intake = useIntake();
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Group | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
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

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return groupSignals(
      (signals.data ?? []).filter(
        (s) => (!source || s.source === source) && (!needle || `${s.title} ${s.body} ${s.component ?? ""} ${s.vin ?? ""}`.toLowerCase().includes(needle)),
      ),
    );
  }, [signals.data, source, q]);
  const shown = groups.reduce((n, g) => n + g.count, 0);

  return (
    <PageBody>
      <PageHeader
        title="Signals"
        description="Reports from every channel, triaged and grouped into clusters that become cases."
        actions={<AgentStatus intake={intake.data} checkingUntil={intake.checkingUntil} live={live} onClick={() => setFeedOpen(true)} />}
      />
      <SourceTabs sources={intake.data?.sources} total={signals.data?.length ?? 0} checkingUntil={intake.checkingUntil} selected={source} onSelect={setSource} />
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="h-fit min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <h3 className="text-[15px] font-semibold">Reports</h3>
            <span className="tnum text-sm text-faint">{groups.length} unique · {shown} total</span>
            <div className="relative ml-auto w-72">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports" className="pl-8" />
            </div>
          </div>
          {signals.error && !signals.data ? (
            <div className="p-4"><ErrorState error={signals.error} onRetry={signals.reload} /></div>
          ) : signals.loading && !signals.data ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : !groups.length ? (
            <Empty title="No reports match" hint={source || q ? "Try another source or search." : "Reports appear here as crawlers and devices send them."} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Report</Th>
                  <Th>Priority</Th>
                  <Th>Case</Th>
                  <Th className="text-right">Last received</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const meta = SOURCE_META[g.latest.source];
                  const Icon = meta?.icon;
                  return (
                    <Tr key={g.key} className={cn("cursor-pointer", arrived.has(g.latest.id) && "animate-flash")} onClick={() => setOpen(g)}>
                      <Td className="w-full max-w-0">
                        <div className="flex items-center gap-3">
                          <span title={meta?.label} className="flex h-7 w-7 shrink-0 items-center justify-center rounded" style={{ background: `${meta?.color ?? "#888"}1f`, color: meta?.color }}>
                            {Icon && <Icon size={14} />}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-fg">{g.title}</span>
                              {g.count > 1 && <span className="tnum shrink-0 rounded-full bg-fg/[0.08] px-1.5 text-xs font-semibold text-muted">×{g.count}</span>}
                            </div>
                            <div className="truncate text-xs text-faint">{meta?.label ?? g.latest.source}{g.latest.component ? ` · ${g.latest.component}` : ""}</div>
                          </div>
                        </div>
                      </Td>
                      <Td><SeverityBadge severity={g.latest.severity} /></Td>
                      <Td className="whitespace-nowrap">{g.latest.case_id ? <IssueKey id={g.latest.case_id} /> : <span className="text-faint">—</span>}</Td>
                      <Td className="tnum whitespace-nowrap text-right text-xs text-faint">{timeAgo(g.latest.created_at)}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
        <ClustersPanel clusters={clusters.data} loading={clusters.loading && !clusters.data} error={clusters.error} onChange={clusters.reload} />
      </div>
      <SignalSheet signal={open?.latest ?? null} count={open?.count ?? 1} onClose={() => setOpen(null)} />
      <Sheet open={feedOpen} onOpenChange={setFeedOpen} title="Intake agent activity" description="Every check, find and triage decision, newest first" width="w-[480px]">
        <div className="p-4"><AgentFeed intake={intake.data} checkingUntil={intake.checkingUntil} live={live} /></div>
      </Sheet>
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
      <CardHeader icon={Layers} title="Clusters" description="Similar reports grouped together. A cluster opens a case once enough independent people report it." />
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
                    <div className="text-sm font-medium leading-5">{c.title}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                      <span className="inline-flex items-center gap-1"><Tag size={11} />{c.component ?? "Unclassified"}</span>
                      {c.sw_version && <span className="inline-flex items-center gap-1"><Package size={11} />{c.sw_version}</span>}
                      <span className="inline-flex items-center gap-1"><Users size={11} />{c.authors}</span>
                      <span className="inline-flex items-center gap-1"><Clock size={11} />{timeAgo(c.last_seen)}</span>
                    </div>
                  </div>
                  {c.case_id ? (
                    <IssueKey id={c.case_id} className="shrink-0" />
                  ) : (
                    <Button size="sm" variant="secondary" disabled={busy === c.id} onClick={() => promote(c.id)}>Promote</Button>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <ThresholdGauge score={c.authors} threshold={c.threshold} crossed={crossed} />
                  <span className={cn("tnum shrink-0 text-xs", crossed ? "text-ok" : "text-fg")}>
                    {c.authors}<span className="text-faint">/{c.threshold} reporters</span>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SignalSheet({ signal, count, onClose }: { signal: Signal | null; count: number; onClose: () => void }) {
  const s = signal;
  const fields: [string, React.ReactNode][] = s
    ? [
        ["Source", <SourceBadge source={s.source} />],
        ["Received", <span className="text-sm">{fmtTime(s.created_at)}</span>],
        ["Author", s.author ?? "—"],
        ["Component", <span className="text-sm">{s.component ?? "—"}</span>],
        ["SW version", <span className="font-mono text-[12px]">{s.sw_version ?? "—"}</span>],
        ["Vehicle model", s.vehicle_model ?? "—"],
        ["Severity", <SeverityBadge severity={s.severity} />],
        ["Classified as bug", s.is_bug == null ? "—" : s.is_bug ? "Yes" : "No"],
        ["Cluster", <span className="text-sm">{s.cluster_id ?? "—"}</span>],
        ["Case", s.case_id ? <IssueKey id={s.case_id} /> : "—"],
        ...(s.vin ? ([["VIN", <span className="font-mono text-[12px]">{s.vin}</span>]] as [string, React.ReactNode][]) : []),
        ...(s.rule_id ? ([["Rule", <span className="text-sm">{s.rule_id}</span>]] as [string, React.ReactNode][]) : []),
      ]
    : [];
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()} eyebrow={s ? SOURCE_META[s.source]?.label ?? s.source : undefined} title={s?.title ?? ""} description={s?.id}>
      {s && (
        <div className="space-y-6 p-5">
          {count > 1 && <p className="rounded-md bg-accent/[0.08] px-3 py-2 text-sm text-fg">Received <b>{count} times</b> from this source. Showing the latest.</p>}
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
                {s.conditions.map((c) => <span key={c} className="rounded-sm border border-border bg-raised px-1.5 py-0.5 text-2xs">{c}</span>)}
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
                    <dd className="tnum mt-1 text-[15px]">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
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

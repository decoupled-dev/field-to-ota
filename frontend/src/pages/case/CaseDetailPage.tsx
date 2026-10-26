import { useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, GitBranch, Workflow } from "lucide-react";
import { api, type Case, type CaseDetail, type F2FEvent, type LogLine, type StageRun } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, Skeleton, Empty } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, LinkChip, SeverityBadge, SourceBadge } from "@/components/domain";
import { fmtTime, timeAgo } from "@/lib/utils";
import { PipelineGraph } from "./PipelineGraph";
import { VModelView } from "./VModelView";
import { StagePanel } from "./StagePanel";
import { ApprovalBanner } from "./ApprovalBanner";
import { FleetPanel } from "./FleetPanel";

export default function CaseDetailPage() {
  const { id = "" } = useParams();
  const { stages } = useApp();
  const detail = useAsync(() => api.caseDetail(id), [id]);
  const [params, setParams] = useSearchParams();
  const view: "pipeline" | "v" = params.get("view") === "v" ? "v" : "pipeline";
  const setView = (v: "pipeline" | "v") =>
    setParams((p) => {
      if (v === "v") p.set("view", "v");
      else p.delete("view");
      return p;
    }, { replace: true });
  // Selected stage lives in the URL (?stage=fix) so a stage can be deep-linked from Jira or a PR.
  const selected = params.get("stage");
  const setSelected = useCallback(
    (k: string | null) =>
      setParams((p) => {
        if (k) p.set("stage", k);
        else p.delete("stage");
        return p;
      }, { replace: true }),
    [setParams],
  );

  const { setData, reload } = detail;

  const onEvent = useCallback(
    (e: F2FEvent) => {
      if (e.case_id && e.case_id !== id) return;
      setData((prev) => (prev ? applyEvent(prev, e) : prev));
      if (e.type === "signal.created") reload();
    },
    [id, setData, reload],
  );
  const live = useEventStream(id ? `/api/cases/${encodeURIComponent(id)}/events` : null, onEvent);

  // Fallback polling while the event stream is unavailable.
  useEffect(() => {
    if (live) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [live, reload]);

  const runs = useMemo(() => Object.fromEntries((detail.data?.stages ?? []).map((r) => [r.stage, r])), [detail.data]);
  const awaiting = detail.data?.stages.find((r) => r.status === "awaiting_approval");
  const selIndex = stages.findIndex((s) => s.key === selected);

  if (detail.error && !detail.data) return <PageBody><ErrorState error={detail.error} onRetry={reload} /></PageBody>;
  if (!detail.data) return <PageBody><Skeleton className="h-24" /><Skeleton className="mt-6 h-[360px]" /></PageBody>;

  const c = detail.data.case;
  return (
    <PageBody>
      <CaseHeader c={c} live={live} />
      {awaiting && (
        <div className="mt-6">
          <ApprovalBanner caseId={c.id} run={awaiting} onDone={reload} />
        </div>
      )}
      <Tabs defaultValue="pipeline" className="mt-6">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="fleet">Fleet & OTA</TabsTrigger>
          <TabsTrigger value="signals">
            Signals <span className="tnum ml-1 text-muted">{detail.data.signals.length}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pipeline" className="pt-4">
          <Card>
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <div className="text-xs text-muted">Select a stage to inspect agent reasoning, artifacts and linked tools.</div>
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "pipeline", label: "Pipeline", icon: <Workflow size={12} /> },
                  { value: "v", label: "V-model", icon: <GitBranch size={12} /> },
                ]}
              />
            </div>
            <div className="p-2">
              {!stages.length ? (
                <Skeleton className="h-[330px]" />
              ) : view === "pipeline" ? (
                <PipelineGraph stages={stages} runs={runs} selected={selected} onSelect={setSelected} />
              ) : (
                <VModelView stages={stages} runs={runs} selected={selected} onSelect={setSelected} />
              )}
            </div>
          </Card>
          <ActivityFeed runs={detail.data.stages} onSelect={setSelected} />
        </TabsContent>
        <TabsContent value="fleet" className="pt-4">
          <FleetPanel caseId={c.id} refreshKey={c.updated_at} />
        </TabsContent>
        <TabsContent value="signals" className="pt-4">
          <CaseSignals detail={detail.data} />
        </TabsContent>
      </Tabs>
      <StagePanel def={stages[selIndex]} run={selected ? runs[selected] : undefined} index={selIndex} onClose={() => setSelected(null)} />
    </PageBody>
  );
}

function applyEvent(prev: CaseDetail, e: F2FEvent): CaseDetail {
  switch (e.type) {
    case "case.updated":
    case "case.created": {
      const c = e.data.case as Case | undefined;
      return c ? { ...prev, case: c } : prev;
    }
    case "stage.updated": {
      const s = e.data.stage as StageRun | undefined;
      if (!s) return prev;
      const exists = prev.stages.some((r) => r.stage === s.stage);
      return { ...prev, stages: exists ? prev.stages.map((r) => (r.stage === s.stage ? s : r)) : [...prev.stages, s] };
    }
    case "stage.log": {
      const key = e.data.stage as string;
      const line = e.data.line as LogLine;
      return { ...prev, stages: prev.stages.map((r) => (r.stage === key ? { ...r, logs: [...r.logs, line] } : r)) };
    }
    default:
      return prev;
  }
}

function CaseHeader({ c, live }: { c: Case; live: boolean }) {
  const meta: [string, React.ReactNode][] = [
    ["Severity", <SeverityBadge severity={c.severity} />],
    ["Component", c.component ?? "—"],
    [
      "Software",
      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
        {c.sw_version ?? "—"}
        {c.fixed_version && (
          <>
            <ArrowRight size={12} className="text-muted" />
            <span className="text-ok">{c.fixed_version}</span>
          </>
        )}
      </span>,
    ],
    ["Vehicle", c.vehicle_model ?? "—"],
    ["Affected / fixed", <span className="tnum">{c.affected_vins} / {c.fixed_vins}</span>],
    ["Opened", fmtTime(c.created_at)],
  ];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted">{c.id}</span>
        <CaseStatusChip status={c.status} />
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted">
          <span className={live ? "h-1.5 w-1.5 animate-pulseSoft rounded-full bg-ok" : "h-1.5 w-1.5 rounded-full bg-warn"} />
          {live ? "Live" : "Polling"}
        </span>
      </div>
      <h1 className="mt-1.5 text-lg font-semibold tracking-tight">{c.title}</h1>
      <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {meta.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5">{v}</dd>
          </div>
        ))}
      </dl>
      {c.links.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {c.links.map((l, i) => <LinkChip key={i} link={l} />)}
        </div>
      )}
    </div>
  );
}

function ActivityFeed({ runs, onSelect }: { runs: StageRun[]; onSelect: (k: string) => void }) {
  const { stages } = useApp();
  const name = (k: string) => stages.find((s) => s.key === k)?.name ?? k;
  const lines = runs
    .flatMap((r) => r.logs.filter((l) => l.level !== "thought").map((l) => ({ ...l, stage: r.stage })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 14);
  return (
    <Card className="mt-6">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold">Activity</h3>
        <p className="mt-0.5 text-xs text-muted">Most recent agent and tool actions across stages</p>
      </div>
      {lines.length ? (
        <ul className="divide-y divide-border">
          {lines.map((l, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="tnum w-16 shrink-0 text-xs text-muted">{timeAgo(l.ts)}</span>
              <button onClick={() => onSelect(l.stage)} className="w-32 shrink-0 truncate text-left text-xs font-medium text-accent hover:underline">{name(l.stage)}</button>
              <span className={`min-w-0 flex-1 truncate ${l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : ""}`}>{l.msg}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No activity yet" />
      )}
    </Card>
  );
}

function CaseSignals({ detail }: { detail: CaseDetail }) {
  if (!detail.signals.length) return <Card><Empty title="No linked signals" /></Card>;
  return (
    <Card>
      <Table>
        <thead>
          <tr>
            <Th>Source</Th>
            <Th>Title</Th>
            <Th>Author / VIN</Th>
            <Th>SW</Th>
            <Th className="text-right">Received</Th>
          </tr>
        </thead>
        <tbody>
          {detail.signals.map((s) => (
            <Tr key={s.id}>
              <Td><SourceBadge source={s.source} /></Td>
              <Td className="max-w-[460px]">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">{s.title}</a>
                ) : (
                  <span className="block truncate font-medium">{s.title}</span>
                )}
                {s.body && <span className="block truncate text-xs text-muted">{s.body}</span>}
              </Td>
              <Td className="font-mono text-xs">{s.vin ?? s.author ?? "—"}</Td>
              <Td className="font-mono text-xs">{s.sw_version ?? "—"}</Td>
              <Td className="whitespace-nowrap text-right text-xs text-muted">{timeAgo(s.created_at)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

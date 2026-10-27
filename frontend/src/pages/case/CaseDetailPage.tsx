import { useCallback, useEffect, useMemo } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Activity, ArrowRight, ChartGantt, GitMerge } from "lucide-react";
import { api, type Case, type CaseDetail, type F2FEvent, type LogLine, type StageRun } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { Breadcrumbs, PageBody } from "@/components/layout/Page";
import { Card, CardHeader } from "@/components/ui/card";
import { Segmented, TabCount, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorState, Skeleton, Empty } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, LinkChip, SeverityBadge, SourceBadge } from "@/components/domain";
import { cn, fmtClock, timeAgo } from "@/lib/utils";
import { StageTape } from "./StageTape";
import { VModelView } from "./VModelView";
import { TimelineView } from "./TimelineView";
import { StageInspector } from "./StagePanel";
import { ApprovalBanner } from "./ApprovalBanner";
import { FleetPanel } from "./FleetPanel";

type View = "v" | "timeline";

export default function CaseDetailPage() {
  const { id = "" } = useParams();
  const { stages } = useApp();
  const detail = useAsync(() => api.caseDetail(id), [id]);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "timeline" ? "timeline" : "v";
  const setView = (v: View) =>
    setParams((p) => {
      if (v === "timeline") p.set("view", "timeline");
      else p.delete("view");
      return p;
    }, { replace: true });
  // Selected stage lives in the URL (?stage=fix) so a stage can be deep-linked from Jira or a PR.
  const selectedParam = params.get("stage");
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

  // Without an explicit selection the inspector follows the live stage, else the last one that ran.
  const focus = useMemo(() => {
    const live = stages.find((s) => ["running", "awaiting_approval", "failed"].includes(runs[s.key]?.status ?? ""));
    const last = [...stages].reverse().find((s) => runs[s.key] && runs[s.key].status !== "pending");
    return (live ?? last ?? stages[0])?.key ?? null;
  }, [stages, runs]);
  const selected = selectedParam ?? focus;
  const selIndex = stages.findIndex((s) => s.key === selected);

  if (detail.error && !detail.data) return <PageBody><ErrorState error={detail.error} onRetry={reload} /></PageBody>;
  if (!detail.data) return <PageBody><Skeleton className="h-28" /><Skeleton className="mt-6 h-16" /><Skeleton className="mt-6 h-[460px]" /></PageBody>;

  const c = detail.data.case;
  return (
    <PageBody>
      <CaseHeader c={c} live={live} />

      <div className="mt-6">
        {stages.length ? <StageTape stages={stages} runs={runs} selected={selected} onSelect={setSelected} /> : <Skeleton className="h-[74px]" />}
      </div>

      {awaiting && (
        <div className="mt-5">
          <ApprovalBanner caseId={c.id} run={awaiting} onDone={reload} />
        </div>
      )}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_440px]">
        <Card className="ticks overflow-hidden">
          <CardHeader
            icon={view === "v" ? GitMerge : ChartGantt}
            title={view === "v" ? "V-model" : "Timeline"}
            description={view === "v" ? "Field → diagnose down the right side → fix on the left → verify back up to the vehicle" : "Time spent per stage; the human gate is shown hatched"}
            action={
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "v", label: "V-model" },
                  { value: "timeline", label: "Timeline" },
                ]}
              />
            }
          />
          <div className={cn(view === "v" && "px-3 py-4")}>
            {!stages.length ? (
              <Skeleton className="m-4 h-[420px]" />
            ) : view === "v" ? (
              <VModelView stages={stages} runs={runs} selected={selected} onSelect={setSelected} />
            ) : (
              <TimelineView stages={stages} runs={runs} selected={selected} onSelect={setSelected} />
            )}
          </div>
        </Card>
        <StageInspector
          def={stages[selIndex]}
          run={selected ? runs[selected] : undefined}
          index={selIndex}
          total={stages.length}
          onStep={(d) => {
            const next = stages[selIndex + d];
            if (next) setSelected(next.key);
          }}
        />
      </div>

      <Tabs defaultValue="activity" className="mt-8">
        <TabsList>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="fleet">Fleet &amp; OTA</TabsTrigger>
          <TabsTrigger value="signals">Signals <TabCount n={detail.data.signals.length} /></TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="pt-5">
          <ActivityFeed runs={detail.data.stages} onSelect={setSelected} />
        </TabsContent>
        <TabsContent value="fleet" className="pt-5">
          <FleetPanel caseId={c.id} refreshKey={c.updated_at} />
        </TabsContent>
        <TabsContent value="signals" className="pt-5">
          <CaseSignals detail={detail.data} />
        </TabsContent>
      </Tabs>
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
  const fixedPct = c.affected_vins ? Math.round((c.fixed_vins / c.affected_vins) * 100) : 0;
  const spec: [string, React.ReactNode][] = [
    ["Component", <span>{c.component ?? "—"}</span>],
    [
      "Software",
      <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px]">
        <span className={c.fixed_version ? "text-muted line-through decoration-faint" : ""}>{c.sw_version ?? "—"}</span>
        {c.fixed_version && (
          <>
            <ArrowRight size={12} className="text-faint" />
            <span className="text-ok">{c.fixed_version}</span>
          </>
        )}
      </span>,
    ],
    [
      "Fleet impact",
      <span className="block">
        <span className="tnum">
          {c.affected_vins} <span className="text-faint">affected ·</span> <span className={c.fixed_vins ? "text-ok" : ""}>{c.fixed_vins}</span> <span className="text-faint">fixed</span>
        </span>
        <span className="mt-1.5 block h-[3px] w-full max-w-[180px] overflow-hidden rounded-full bg-subtle">
          <span className="block h-full bg-ok" style={{ width: `${fixedPct}%` }} />
        </span>
      </span>,
    ],
    ["Updated", <span className="tnum">{timeAgo(c.updated_at)}</span>],
  ];
  return (
    <div>
      <div className="flex items-center gap-3">
        <Breadcrumbs items={[{ label: "Cases", to: "/cases" }, { label: c.id }]} />
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-faint">
          <span className={cn("h-2 w-2 rounded-full", live ? "animate-pulseSoft bg-ok" : "bg-warn")} />
          {live ? "Live stream" : "Polling"}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-10 gap-y-4">
        <div className="min-w-0 max-w-4xl">
          <h1 className="text-2xl font-semibold leading-8 text-fg">{c.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <CaseStatusChip status={c.status} />
            <SeverityBadge severity={c.severity} />
          </div>
        </div>
        {c.links.length > 0 && (
          <div className="flex max-w-[640px] flex-wrap justify-end gap-1.5">
            {c.links.map((l, i) => <LinkChip key={i} link={l} />)}
          </div>
        )}
      </div>
      <dl className="panel mt-5 grid grid-cols-2 md:grid-cols-4">
        {spec.map(([k, v], i) => (
          <div key={k} className={cn("px-4 py-3", i > 0 && "md:border-l md:border-border")}>
            <dt className="label">{k}</dt>
            <dd className="mt-1 text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const LEVEL_CLS: Record<string, string> = { error: "text-bad", warn: "text-warn", tool: "text-info", info: "text-faint" };

function ActivityFeed({ runs, onSelect }: { runs: StageRun[]; onSelect: (k: string) => void }) {
  const { stages } = useApp();
  const idx = (k: string) => stages.findIndex((s) => s.key === k);
  const name = (k: string) => stages.find((s) => s.key === k)?.name ?? k;
  const lines = runs
    .flatMap((r) => r.logs.filter((l) => l.level !== "thought").map((l) => ({ ...l, stage: r.stage })))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 18);
  return (
    <Card>
      <CardHeader icon={Activity} title="Activity" description="Most recent agent and tool actions across stages" />
      {lines.length ? (
        <ul className="py-1.5 font-mono text-[12px] leading-5">
          {lines.map((l, i) => (
            <li key={i} className="grid grid-cols-[72px_180px_48px_1fr] items-baseline gap-3 px-4 py-1 hover:bg-subtle/50">
              <span className="tnum text-faint">{fmtClock(l.ts)}</span>
              <button onClick={() => onSelect(l.stage)} className="truncate text-left text-muted hover:text-accent">
                <span className="text-faint">{String(idx(l.stage) + 1).padStart(2, "0")}</span> {name(l.stage)}
              </button>
              <span className={cn("uppercase", LEVEL_CLS[l.level] ?? "text-faint")}>{l.level}</span>
              <span className={cn("min-w-0 truncate", l.level === "error" ? "text-bad" : l.level === "warn" ? "text-warn" : "text-fg")}>{l.msg}</span>
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
              <Td className="max-w-[520px]">
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:text-accent">{s.title}</a>
                ) : (
                  <span className="block truncate text-[13px] font-medium">{s.title}</span>
                )}
                {s.body && <span className="block truncate text-xs text-muted">{s.body}</span>}
              </Td>
              <Td className="font-mono text-[12px] text-muted">{s.vin ?? s.author ?? "—"}</Td>
              <Td className="font-mono text-[12px]">{s.sw_version ?? "—"}</Td>
              <Td className="tnum whitespace-nowrap text-right text-2xs text-faint">{timeAgo(s.created_at)}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

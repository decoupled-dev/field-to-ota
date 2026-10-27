import { Link, useSearchParams } from "react-router-dom";
import { Car, Kanban, List } from "lucide-react";
import { api, type Case } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/tabs";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, IssueKey, PHASES, PriorityIcon, SeverityBadge, StageStrip, StatusIcon, inferStageStatuses, phaseOf } from "@/components/domain";
import { cn, timeAgo } from "@/lib/utils";

type View = "board" | "list";

export default function CasesPage() {
  const cases = useAsync(api.cases, [], 10000);
  const [params, setParams] = useSearchParams();
  const view: View = params.get("view") === "list" ? "list" : "board";
  const setView = (v: View) =>
    setParams((p) => {
      if (v === "list") p.set("view", "list");
      else p.delete("view");
      return p;
    }, { replace: true });
  useEventStream("/api/events", (e) => {
    if (e.type.startsWith("case.") || e.type === "stage.updated" || e.type === "demo.reset") cases.reload();
  });

  return (
    <PageBody>
      <PageHeader
        title="Cases"
        description="Each case is one field defect taken through the closed-loop pipeline, from first report to verified OTA."
        actions={
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: "board", label: "Board", icon: <Kanban size={13} /> },
              { value: "list", label: "List", icon: <List size={13} /> },
            ]}
          />
        }
      />
      {cases.error && !cases.data ? (
        <ErrorState error={cases.error} onRetry={cases.reload} />
      ) : !cases.data ? (
        <div className="grid gap-3 md:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : !cases.data.length ? (
        <Card><Empty title="No cases yet" hint="Cases open automatically when a signal cluster crosses its threshold." /></Card>
      ) : view === "board" ? (
        <Board cases={cases.data} />
      ) : (
        <Card><CaseList cases={cases.data} /></Card>
      )}
    </PageBody>
  );
}

const COLUMNS = [...PHASES.map((p) => ({ key: p.key, title: p.title })), { key: "done", title: "Done" }];

/** Jira-style board: one column per pipeline phase; cases move right as agents finish stages. */
function Board({ cases }: { cases: Case[] }) {
  return (
    <div className="grid items-start gap-3 md:grid-cols-5">
      {COLUMNS.map((col) => {
        const items = cases.filter((c) => phaseOf(c.current_stage, c.status) === col.key);
        return (
          <section key={col.key} className="flex min-h-[320px] flex-col rounded-lg bg-subtle/80 p-2">
            <header className="flex items-center gap-2 px-2 pb-2 pt-1.5">
              <h3 className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{col.title}</h3>
              <span className="tnum rounded-full bg-fg/[0.08] px-1.5 text-2xs font-semibold text-muted">{items.length}</span>
              {col.key === "done" && <span className="ml-auto text-ok" title="Closed: fixed and verified in the field">✓</span>}
            </header>
            <div className="flex flex-1 flex-col gap-2">
              {items.length ? items.map((c) => <BoardCard key={c.id} c={c} />) : (
                <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-strong/60 px-3 py-8 text-center text-xs text-faint">No cases in {col.title.toLowerCase()}</div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BoardCard({ c }: { c: Case }) {
  const { stages } = useApp();
  const stage = stages.find((s) => s.key === c.current_stage);
  const live = c.status === "running" || c.status === "awaiting_approval" || c.status === "releasing";
  const pct = c.affected_vins ? Math.round((c.fixed_vins / c.affected_vins) * 100) : 0;
  return (
    <Link
      to={`/cases/${c.id}`}
      className={cn(
        "group block rounded-md bg-surface p-3 shadow-card transition-[box-shadow,background-color] hover:bg-raised hover:shadow-overlay",
        c.status === "awaiting_approval" && "ring-2 ring-warn/60",
        c.status === "failed" && "ring-2 ring-bad/50",
      )}
    >
      <p className="line-clamp-3 text-sm leading-5 text-fg group-hover:text-accent">{c.title}</p>
      {live && stage && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
          <StatusIcon status={c.status === "awaiting_approval" ? "awaiting_approval" : "running"} size={11} />
          {c.status === "awaiting_approval" ? "Waiting for approval" : stage.name}
        </p>
      )}
      {c.affected_vins > 0 && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-xs text-faint">
            <span className="inline-flex items-center gap-1"><Car size={12} />{c.fixed_vins} / {c.affected_vins} fixed</span>
            <span className="tnum">{pct}%</span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <IssueKey id={c.id} className="text-xs" />
        <span className="flex items-center gap-2">
          <span className="tnum text-xs text-faint">{timeAgo(c.updated_at)}</span>
          <PriorityIcon severity={c.severity} size={15} />
        </span>
      </div>
    </Link>
  );
}

function CaseList({ cases }: { cases: Case[] }) {
  const { stages } = useApp();
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
        {cases.map((c) => (
          <Tr key={c.id}>
            <Td><IssueKey id={c.id} /></Td>
            <Td className="w-full max-w-0"><Link to={`/cases/${c.id}`} className="block truncate text-sm hover:text-accent">{c.title}</Link></Td>
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

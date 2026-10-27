import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, SeverityBadge, StageStrip, inferStageStatuses } from "@/components/domain";
import { timeAgo } from "@/lib/utils";

export default function CasesPage() {
  const cases = useAsync(api.cases, [], 10000);
  const { stages } = useApp();
  useEventStream("/api/events", (e) => {
    if (e.type.startsWith("case.")) cases.reload();
  });
  const open = cases.data?.filter((c) => c.status !== "closed").length ?? 0;
  return (
    <PageBody>
      <PageHeader
        title="Cases"
        description="Each case is one field defect taken through the closed-loop pipeline, from first report to verified OTA."
        actions={cases.data && <><Badge tone="run">{open} open</Badge><Badge>{cases.data.length - open} closed</Badge></>}
      />
      <Card>
        {cases.error && !cases.data ? (
          <div className="p-4"><ErrorState error={cases.error} onRetry={cases.reload} /></div>
        ) : !cases.data ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
        ) : !cases.data.length ? (
          <Empty title="No cases yet" hint="Cases open automatically when a signal cluster crosses its threshold." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Case</Th>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Severity</Th>
                <Th>Pipeline</Th>
                <Th className="text-right">Fixed / affected</Th>
                <Th className="text-right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {cases.data.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-[12px]"><Link to={`/cases/${c.id}`} className="hover:text-accent">{c.id}</Link></Td>
                  <Td className="max-w-[520px] truncate text-[13px] font-medium"><Link to={`/cases/${c.id}`} className="hover:text-accent">{c.title}</Link></Td>
                  <Td><CaseStatusChip status={c.status} /></Td>
                  <Td><SeverityBadge severity={c.severity} /></Td>
                  <Td><StageStrip stages={stages} runs={inferStageStatuses(stages, c.current_stage, c.status)} /></Td>
                  <Td className="tnum text-right"><span className={c.fixed_vins ? "text-ok" : "text-faint"}>{c.fixed_vins}</span><span className="text-faint"> / {c.affected_vins}</span></Td>
                  <Td className="tnum whitespace-nowrap text-right text-xs text-faint">{timeAgo(c.updated_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}

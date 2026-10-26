import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAsync, useEventStream } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { CaseStatusChip, SeverityBadge, StageStrip, inferStageStatuses } from "@/components/domain";
import { fmtTime, timeAgo } from "@/lib/utils";

export default function CasesPage() {
  const cases = useAsync(api.cases, [], 10000);
  const { stages } = useApp();
  useEventStream("/api/events", (e) => {
    if (e.type.startsWith("case.")) cases.reload();
  });
  return (
    <PageBody>
      <PageHeader title="Cases" description="Each case is one field defect taken through the closed-loop fix pipeline." />
      <Card>
        {cases.error && !cases.data ? (
          <div className="p-4"><ErrorState error={cases.error} onRetry={cases.reload} /></div>
        ) : !cases.data ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
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
                <Th>Component</Th>
                <Th>SW</Th>
                <Th>Pipeline</Th>
                <Th className="text-right">Affected</Th>
                <Th className="text-right">Fixed</Th>
                <Th className="text-right">Opened</Th>
                <Th className="text-right">Updated</Th>
              </tr>
            </thead>
            <tbody>
              {cases.data.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-mono text-xs"><Link to={`/cases/${c.id}`} className="text-accent hover:underline">{c.id}</Link></Td>
                  <Td className="max-w-[360px] truncate font-medium"><Link to={`/cases/${c.id}`} className="hover:underline">{c.title}</Link></Td>
                  <Td><CaseStatusChip status={c.status} /></Td>
                  <Td><SeverityBadge severity={c.severity} /></Td>
                  <Td className="text-xs">{c.component ?? "—"}</Td>
                  <Td className="font-mono text-xs">{c.sw_version ?? "—"}</Td>
                  <Td><StageStrip stages={stages} runs={inferStageStatuses(stages, c.current_stage, c.status)} /></Td>
                  <Td className="tnum text-right">{c.affected_vins}</Td>
                  <Td className="tnum text-right">{c.fixed_vins}</Td>
                  <Td className="whitespace-nowrap text-right text-xs text-muted">{fmtTime(c.created_at)}</Td>
                  <Td className="whitespace-nowrap text-right text-xs text-muted">{timeAgo(c.updated_at)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </PageBody>
  );
}

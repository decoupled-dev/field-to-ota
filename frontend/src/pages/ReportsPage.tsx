import { ArrowUpRight, Car, FileCheck2, FileSearch, FileText, type LucideIcon } from "lucide-react";
import { api, reportUrl, type Case } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { CaseStatusChip, IssueKey } from "@/components/domain";

const FALLBACK = [
  { type: "evidence", title: "Evidence pack", description: "Traceability matrix complaint → requirement → commit → test → release (ASPICE, UNECE R156)." },
  { type: "rca", title: "Root cause analysis", description: "Evidence chain from field logs and code to the defect mechanism." },
  { type: "fleet", title: "Fleet impact", description: "Affected cohort, segmentation and OTA rollout results." },
];
const KIND: Record<string, { icon: LucideIcon; cls: string }> = {
  evidence: { icon: FileCheck2, cls: "bg-ok/10 text-ok" },
  rca: { icon: FileSearch, cls: "bg-info/10 text-info" },
  fleet: { icon: Car, cls: "bg-accent/10 text-accent" },
};

export default function ReportsPage() {
  const cases = useAsync(api.cases, []);
  return (
    <PageBody>
      <PageHeader title="Reports" description="Generated per case from the pipeline record. Open a report and print to PDF for audit, homologation or supplier hand-off." />
      {cases.error && !cases.data ? (
        <ErrorState error={cases.error} onRetry={cases.reload} />
      ) : !cases.data ? (
        <Skeleton className="h-40" />
      ) : !cases.data.length ? (
        <Card><Empty title="No reports yet" hint="Reports are generated as a case moves through the pipeline." /></Card>
      ) : (
        <div className="space-y-5">{cases.data.map((c) => <CaseReports key={c.id} c={c} />)}</div>
      )}
    </PageBody>
  );
}

function CaseReports({ c }: { c: Case }) {
  const reports = useAsync(() => api.reports(c.id), [c.id]);
  const list = reports.data ?? (reports.error ? FALLBACK.map((r) => ({ ...r, url: reportUrl(c.id, r.type) })) : []);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <IssueKey id={c.id} />
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{c.title}</h2>
        <CaseStatusChip status={c.status} />
      </div>
      {reports.loading && !reports.data ? (
        <div className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((r) => {
            const k = KIND[r.type] ?? { icon: FileText, cls: "bg-subtle text-muted" };
            return (
              <li key={r.type}>
                <a href={r.url || reportUrl(c.id, r.type)} target="_blank" rel="noreferrer" className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-subtle/70">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${k.cls}`}><k.icon size={17} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-fg group-hover:text-accent">{r.title}</div>
                    <div className="truncate text-xs text-faint">{r.description}</div>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded bg-fg/[0.06] px-2.5 py-1.5 text-xs font-medium text-fg group-hover:bg-fg/[0.10]">
                    Open <ArrowUpRight size={13} />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

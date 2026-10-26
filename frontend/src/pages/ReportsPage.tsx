import { ArrowUpRight, ClipboardCheck, FileSearch, Truck } from "lucide-react";
import { Link } from "react-router-dom";
import { api, reportUrl, type Case } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { CaseStatusChip } from "@/components/domain";

const FALLBACK = [
  { type: "evidence", title: "Evidence pack", description: "Traceability matrix complaint → requirement → commit → test → release (ASPICE, UNECE R156)." },
  { type: "rca", title: "Root cause analysis", description: "Evidence chain from field logs and code to the defect mechanism." },
  { type: "fleet", title: "Fleet impact", description: "Affected cohort, segmentation and OTA rollout results." },
];
const ICON: Record<string, typeof ClipboardCheck> = { evidence: ClipboardCheck, rca: FileSearch, fleet: Truck };

export default function ReportsPage() {
  const cases = useAsync(api.cases, []);
  return (
    <PageBody>
      <PageHeader title="Reports" description="Generated per case. Open a report and print to PDF for audit or supplier hand-off." />
      {cases.error && !cases.data ? (
        <ErrorState error={cases.error} onRetry={cases.reload} />
      ) : !cases.data ? (
        <Skeleton className="h-40" />
      ) : !cases.data.length ? (
        <Card><Empty title="No reports yet" hint="Reports are generated as a case moves through the pipeline." /></Card>
      ) : (
        <div className="space-y-6">{cases.data.map((c) => <CaseReports key={c.id} c={c} />)}</div>
      )}
    </PageBody>
  );
}

function CaseReports({ c }: { c: Case }) {
  const reports = useAsync(() => api.reports(c.id), [c.id]);
  const list = reports.data ?? (reports.error ? FALLBACK.map((r) => ({ ...r, url: reportUrl(c.id, r.type) })) : []);
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Link to={`/cases/${c.id}`} className="font-mono text-xs text-accent hover:underline">{c.id}</Link>
            <span>{c.title}</span>
          </span>
        }
        action={<CaseStatusChip status={c.status} />}
      />
      {reports.loading && !reports.data ? (
        <div className="grid gap-px p-4 md:grid-cols-3"><Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : (
        <div className="grid gap-px bg-border md:grid-cols-3">
          {list.map((r) => {
            const Icon = ICON[r.type] ?? FileSearch;
            return (
              <a key={r.type} href={r.url || reportUrl(c.id, r.type)} target="_blank" rel="noreferrer" className="group flex gap-3 bg-surface p-4 hover:bg-subtle/60">
                <Icon size={18} strokeWidth={1.75} className="mt-0.5 shrink-0 text-muted group-hover:text-accent" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1 text-sm font-medium">
                    {r.title}
                    <ArrowUpRight size={13} className="text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                  </div>
                  <div className="mt-0.5 text-xs leading-5 text-muted">{r.description}</div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </Card>
  );
}

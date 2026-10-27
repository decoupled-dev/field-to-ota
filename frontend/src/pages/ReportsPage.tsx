import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { api, reportUrl, type Case } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { CaseStatusChip } from "@/components/domain";

const FALLBACK = [
  { type: "evidence", title: "Evidence pack", description: "Traceability matrix complaint → requirement → commit → test → release (ASPICE, UNECE R156)." },
  { type: "rca", title: "Root cause analysis", description: "Evidence chain from field logs and code to the defect mechanism." },
  { type: "fleet", title: "Fleet impact", description: "Affected cohort, segmentation and OTA rollout results." },
];
const CODE: Record<string, string> = { evidence: "EVP", rca: "RCA", fleet: "FLT" };

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
        <div className="space-y-8">{cases.data.map((c) => <CaseReports key={c.id} c={c} />)}</div>
      )}
    </PageBody>
  );
}

function CaseReports({ c }: { c: Case }) {
  const reports = useAsync(() => api.reports(c.id), [c.id]);
  const list = reports.data ?? (reports.error ? FALLBACK.map((r) => ({ ...r, url: reportUrl(c.id, r.type) })) : []);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Link to={`/cases/${c.id}`} className="font-mono text-[12px] text-muted hover:text-accent">{c.id}</Link>
        <h2 className="text-[15px] font-semibold tracking-tight">{c.title}</h2>
        <CaseStatusChip status={c.status} />
      </div>
      {reports.loading && !reports.data ? (
        <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {list.map((r) => (
            <a
              key={r.type}
              href={r.url || reportUrl(c.id, r.type)}
              target="_blank"
              rel="noreferrer"
              className="group relative flex min-h-[148px] flex-col overflow-hidden rounded-md border border-border bg-surface p-4 transition-colors hover:border-strong"
            >
              <div className="flex items-center gap-2">
                <span className="rounded-sm bg-fg px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-[0.1em] text-bg">{CODE[r.type] ?? r.type.slice(0, 3).toUpperCase()}</span>
                <span className="text-xs text-faint">{c.id}</span>
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-[15px] font-semibold tracking-tight">
                {r.title}
                <ArrowUpRight size={14} className="text-faint transition-colors group-hover:text-accent" />
              </div>
              <div className="mt-1 text-xs leading-5 text-muted">{r.description}</div>
              <div className="mt-auto space-y-1 pt-4" aria-hidden>
                <span className="block h-px w-full bg-border" />
                <span className="block h-px w-4/5 bg-border" />
                <span className="block h-px w-3/5 bg-border" />
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

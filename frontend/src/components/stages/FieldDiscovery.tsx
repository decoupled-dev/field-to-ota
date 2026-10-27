import type { StageRun } from "@/lib/api";
import { Badge } from "../ui/badge";
import { Empty } from "../ui/states";
import { SeverityBadge } from "../../components/domain";

// ---------------------------------------------------------------------------
// Artifact content shapes
// ---------------------------------------------------------------------------

interface SourceCoverageRow {
  source: string;
  category?: string;
  simulated?: boolean;
  issues?: number;
}

interface DiscoveredIssue {
  title?: string;
  source?: string;
  severity?: string | null;
  frequency_score?: number;
  raw_count?: number;
  is_actionable_in_mvp?: boolean;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function getArtifact(run: StageRun, name: string): unknown[] | undefined {
  const art = run.artifacts.find((a) => a.name === name);
  if (!art) return undefined;
  const c = art.content;
  return Array.isArray(c) ? (c as unknown[]) : undefined;
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function MetricsStrip({ run }: { run: StageRun }) {
  const total = run.outputs["total_issues"] as number | undefined;
  const actionable = run.outputs["actionable"] as number | undefined;
  const sourcesLive = run.outputs["sources_live"] as number | undefined;
  const sourcesSim = run.outputs["sources_simulated"] as number | undefined;

  return (
    <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded border border-border bg-surface">
      {/* Total Issues */}
      <div className="min-w-0 px-3 py-2">
        <div className="label text-muted">Total Issues</div>
        <div className="tnum mt-0.5 truncate font-medium text-[13px] text-fg">
          {total != null ? total : "—"}
        </div>
      </div>

      {/* Actionable */}
      <div className="min-w-0 px-3 py-2">
        <div className="label text-muted">Actionable</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="tnum font-medium text-[13px] text-fg">
            {actionable != null ? actionable : "—"}
          </span>
          {actionable != null && (
            <Badge tone={actionable > 0 ? "ok" : "neutral"}>
              {actionable > 0 ? "mvp" : "none"}
            </Badge>
          )}
        </div>
      </div>

      {/* Sources */}
      <div className="min-w-0 px-3 py-2">
        <div className="label text-muted">Sources</div>
        <div className="tnum mt-0.5 font-medium text-[13px] text-fg">
          {sourcesLive != null || sourcesSim != null ? (
            <>
              {sourcesLive ?? 0}
              <span className="text-faint font-normal"> live / </span>
              <span className={(sourcesSim ?? 0) > 0 ? "text-warn" : ""}>{sourcesSim ?? 0}</span>
              <span className="text-faint font-normal"> sim</span>
            </>
          ) : (
            "—"
          )}
        </div>
      </div>
    </div>
  );
}

function SourceCoverageTable({ rows }: { rows: SourceCoverageRow[] }) {
  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-fg">Sources searched</h4>
      <div className="overflow-hidden rounded border border-border divide-y divide-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Source</th>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Category</th>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Status</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold text-faint">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-subtle/50">
                <td className="px-3 py-2 font-medium text-[13px]">{row.source ?? "—"}</td>
                <td className="px-3 py-2 text-xs text-muted">{row.category ?? "—"}</td>
                <td className="px-3 py-2">
                  {row.simulated ? (
                    <Badge tone="warn">Simulated</Badge>
                  ) : (
                    <Badge tone="run">Live</Badge>
                  )}
                </td>
                <td className="tnum px-3 py-2 text-[13px] text-right">{row.issues ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TopIssuesTable({ issues }: { issues: DiscoveredIssue[] }) {
  const sorted = [...issues]
    .sort((a, b) => (b.frequency_score ?? 0) - (a.frequency_score ?? 0))
    .slice(0, 5);

  if (!sorted.length) {
    return <Empty title="No issues discovered yet" />;
  }

  return (
    <section>
      <h4 className="mb-2 text-sm font-semibold text-fg">Top issues by frequency</h4>
      <div className="overflow-hidden rounded border border-border divide-y divide-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface">
              <th className="w-6 px-3 py-1.5 text-left text-xs font-semibold text-faint">#</th>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Title</th>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Source</th>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Severity</th>
              <th className="px-3 py-1.5 text-right text-xs font-semibold text-faint">Count</th>
              <th className="px-3 py-1.5 text-left text-xs font-semibold text-faint">Actionable</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map((issue, i) => (
              <tr key={i} className="hover:bg-subtle/50">
                <td className="tnum w-6 px-3 py-2 text-[13px] text-muted">{i + 1}</td>
                <td className="px-3 py-2 max-w-0">
                  <span className="block truncate text-[13px]">{issue.title ?? "—"}</span>
                </td>
                <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">{issue.source ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <SeverityBadge severity={issue.severity ?? null} />
                </td>
                <td className="tnum px-3 py-2 text-[13px] text-right">{issue.raw_count ?? 0}</td>
                <td className="px-3 py-2">
                  {issue.is_actionable_in_mvp ? (
                    <Badge tone="ok">MVP</Badge>
                  ) : (
                    <Badge tone="neutral">noise</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function FieldDiscoveryStageView({ run }: { run: StageRun }) {
  const sourceCoverage = getArtifact(run, "Source coverage") as SourceCoverageRow[] | undefined;
  const discoveredIssues = getArtifact(run, "Discovered issues") as DiscoveredIssue[] | undefined;

  return (
    <div className="space-y-4">
      {/* (4) Simulated mode callout */}
      {run.simulated && (
        <div
          className="rounded border border-border bg-warn/5 px-3 py-2 text-xs text-warn"
          style={{ borderLeft: "2px solid var(--color-warn)" }}
        >
          Connector is running in simulated mode — results are loaded from seed data, not live sources.
        </div>
      )}

      {/* (1) Top metrics strip */}
      <MetricsStrip run={run} />

      {/* (2) Source coverage */}
      {sourceCoverage && sourceCoverage.length > 0 && (
        <SourceCoverageTable rows={sourceCoverage} />
      )}

      {/* (3) Top issues */}
      {discoveredIssues ? (
        <TopIssuesTable issues={discoveredIssues} />
      ) : (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-fg">Top issues by frequency</h4>
          <Empty title="No issues discovered yet" />
        </section>
      )}
    </div>
  );
}

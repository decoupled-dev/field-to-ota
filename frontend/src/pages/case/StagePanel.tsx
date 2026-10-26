import { ArrowUpRight } from "lucide-react";
import type { StageDef, StageRun } from "@/lib/api";
import { Sheet } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty } from "@/components/ui/states";
import { StageStatusChip, ToolIcon } from "@/components/domain";
import { cn, fmtClock, fmtDuration, fmtTime, humanize } from "@/lib/utils";
import { ArtifactView } from "./ArtifactView";

const LEVEL: Record<string, string> = {
  thought: "text-accent",
  tool: "text-[#8b5cf6]",
  info: "text-muted",
  warn: "text-warn",
  error: "text-bad",
};

function KV({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return <div className="text-xs text-muted">None</div>;
  return (
    <dl className="divide-y divide-border rounded border border-border text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[150px_1fr] gap-3 px-3 py-2">
          <dt className="text-muted">{humanize(k)}</dt>
          <dd className="min-w-0 break-words">
            {v != null && typeof v === "object" ? (
              <pre className="whitespace-pre-wrap font-mono text-[12px] leading-5">{JSON.stringify(v, null, 2)}</pre>
            ) : (
              <span className={cn(typeof v === "number" && "tnum")}>{v == null || v === "" ? "—" : String(v)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function StagePanel({ def, run, index, onClose }: { def: StageDef | undefined; run: StageRun | undefined; index: number; onClose: () => void }) {
  const status = run?.status ?? "pending";
  return (
    <Sheet
      open={!!def}
      onOpenChange={(o) => !o && onClose()}
      width="w-[640px]"
      title={
        def ? (
          <span className="flex items-center gap-2">
            <span className="tnum text-muted">{String(index + 1).padStart(2, "0")}</span>
            {def.name}
            <StageStatusChip status={status} />
          </span>
        ) : ""
      }
      description={def ? `${def.agent} · ${def.v_level}${run?.connector ? ` · via ${run.connector}` : ""}${run?.simulated ? " · simulated connector" : ""}` : undefined}
    >
      {def && (
        <Tabs defaultValue="summary" className="flex h-full flex-col">
          <TabsList className="px-5 pt-2">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="reasoning">Agent reasoning{run?.logs.length ? <span className="tnum ml-1 text-muted">{run.logs.length}</span> : null}</TabsTrigger>
            <TabsTrigger value="artifacts">Artifacts{run?.artifacts.length ? <span className="tnum ml-1 text-muted">{run.artifacts.length}</span> : null}</TabsTrigger>
            <TabsTrigger value="links">Links{run?.links.length ? <span className="tnum ml-1 text-muted">{run.links.length}</span> : null}</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="space-y-5 p-5">
            <p className="text-sm text-muted">{def.description}</p>
            {!run || status === "pending" ? (
              <Empty title="Not started" hint="This stage runs after the previous stage passes." />
            ) : (
              <>
                {run.summary && <div className="rounded border border-border bg-subtle/40 p-3 text-sm leading-6">{run.summary}</div>}
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded border border-border bg-border text-sm">
                  <Stat label="Started" value={fmtTime(run.started_at)} />
                  <Stat label="Duration" value={fmtDuration(run.started_at, run.ended_at) || "—"} />
                  <Stat label="Agent" value={run.agent || def.agent} />
                </div>
                <section>
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Inputs</h4>
                  <KV data={run.inputs} />
                </section>
                <section>
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Outputs</h4>
                  <KV data={run.outputs} />
                </section>
              </>
            )}
          </TabsContent>

          <TabsContent value="reasoning" className="space-y-4 p-5">
            {run?.reasoning && <div className="whitespace-pre-wrap rounded border border-border p-3 text-sm leading-6">{run.reasoning}</div>}
            {run?.logs.length ? (
              <div className="overflow-hidden rounded border border-border bg-subtle/40">
                <div className="max-h-[520px] overflow-auto py-2 font-mono text-[12px] leading-5">
                  {run.logs.map((l, i) => (
                    <div key={i} className="flex gap-3 px-3 hover:bg-subtle">
                      <span className="tnum shrink-0 text-muted/80">{fmtClock(l.ts)}</span>
                      <span className={cn("w-14 shrink-0 uppercase", LEVEL[l.level] ?? "text-muted")}>{l.level}</span>
                      <span className="min-w-0 whitespace-pre-wrap break-words">{l.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              !run?.reasoning && <Empty title="No agent activity yet" />
            )}
          </TabsContent>

          <TabsContent value="artifacts" className="space-y-3 p-5">
            {run?.artifacts.length ? run.artifacts.map((a, i) => <ArtifactView key={`${a.name}-${i}`} artifact={a} />) : <Empty title="No artifacts" />}
          </TabsContent>

          <TabsContent value="links" className="p-5">
            {run?.links.length ? (
              <ul className="divide-y divide-border rounded border border-border">
                {run.links.map((l, i) => (
                  <li key={i}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-subtle">
                      <ToolIcon tool={l.tool} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{l.label}</span>
                        <span className="block truncate text-xs text-muted">{l.url}</span>
                      </span>
                      <span className="rounded bg-subtle px-1.5 py-px text-[11px] capitalize text-muted">{l.tool}</span>
                      <ArrowUpRight size={14} className="text-muted" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No external links" hint="Links to Jira, GitHub, IoT jobs and other tools appear here." />
            )}
          </TabsContent>
        </Tabs>
      )}
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum truncate font-medium">{value}</div>
    </div>
  );
}

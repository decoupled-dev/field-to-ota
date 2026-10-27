import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import type { StageDef, StageRun } from "@/lib/api";
import { Tabs, TabsContent, TabsList, TabsTrigger, TabCount } from "@/components/ui/tabs";
import { Empty } from "@/components/ui/states";
import { StageStatusChip, ToolIcon } from "@/components/domain";
import { cn, fmtClock, fmtDuration, fmtTime, humanize } from "@/lib/utils";
import { ArtifactView } from "./ArtifactView";

const LEVEL: Record<string, { label: string; cls: string }> = {
  thought: { label: "think", cls: "text-info" },
  tool: { label: "tool", cls: "text-info" },
  info: { label: "info", cls: "text-faint" },
  warn: { label: "warn", cls: "text-warn" },
  error: { label: "error", cls: "text-bad" },
};

function KV({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data ?? {});
  if (!entries.length) return <div className="text-xs text-faint">None</div>;
  return (
    <dl className="divide-y divide-border overflow-hidden rounded border border-border">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[132px_1fr] gap-3 px-3 py-2">
          <dt className="pt-px text-xs text-faint">{humanize(k)}</dt>
          <dd className="min-w-0 break-words text-[12.5px]">
            {Array.isArray(v) && v.every((x) => typeof x !== "object") ? (
              <ul className="space-y-1">
                {v.map((x, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                    <span>{String(x)}</span>
                  </li>
                ))}
              </ul>
            ) : v != null && typeof v === "object" ? (
              <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-5 text-muted">{JSON.stringify(v, null, 2)}</pre>
            ) : typeof v === "string" && /^https?:\/\//.test(v) ? (
              <a href={v} target="_blank" rel="noreferrer" className="break-all font-mono text-[11.5px] text-accent hover:underline">{v}</a>
            ) : (
              <span className={cn(typeof v === "number" && "tnum")}>{v == null || v === "" ? "—" : String(v)}</span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Inline inspector for one stage: what the agent did, why, what it produced and where it went. */
export function StageInspector({ def, run, index, total, onStep }: { def: StageDef | undefined; run: StageRun | undefined; index: number; total: number; onStep: (dir: -1 | 1) => void }) {
  if (!def) return <div className="panel"><Empty title="Select a stage" hint="Click any stage on the tape or the schematic." /></div>;
  const status = run?.status ?? "pending";
  return (
    <div className="panel flex min-h-0 flex-col lg:sticky lg:top-[68px] lg:max-h-[calc(100vh-84px)]">
      <div className="border-b border-border px-4 pb-3.5 pt-3">
        <div className="flex items-center justify-between">
          <span className="label">Stage <span className="tnum text-fg">{String(index + 1).padStart(2, "0")}</span> / {total} · {def.v_level}</span>
          <span className="flex">
            <button onClick={() => onStep(-1)} disabled={index <= 0} className="rounded-sm p-1 text-muted hover:bg-subtle hover:text-fg disabled:opacity-30" aria-label="Previous stage"><ChevronLeft size={14} /></button>
            <button onClick={() => onStep(1)} disabled={index >= total - 1} className="rounded-sm p-1 text-muted hover:bg-subtle hover:text-fg disabled:opacity-30" aria-label="Next stage"><ChevronRight size={14} /></button>
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <h2 className="text-[19px] font-semibold leading-6 tracking-[-0.02em]">{def.name}</h2>
          <StageStatusChip status={status} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{run?.agent || def.agent}</span>
          {run?.connector && <span className="text-faint">via <span className="text-fg">{run.connector}</span></span>}
          {run?.simulated && <span className="rounded-sm border border-dashed border-strong px-1 text-faint">simulated connector</span>}
        </div>
      </div>

      <Tabs defaultValue="summary" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="gap-5 px-4 pt-2">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="reasoning">Reasoning{run?.logs.length ? <TabCount n={run.logs.length} /> : null}</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts{run?.artifacts.length ? <TabCount n={run.artifacts.length} /> : null}</TabsTrigger>
          <TabsTrigger value="links">Links{run?.links.length ? <TabCount n={run.links.length} /> : null}</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="summary" className="space-y-4 p-4">
            <p className="text-[12.5px] leading-5 text-muted">{def.description}</p>
            {!run || status === "pending" ? (
              <Empty title="Not started" hint="This stage runs after the previous stage passes." className="py-8" />
            ) : (
              <>
                {run.summary && (
                  <div className="relative rounded border border-border bg-raised py-3 pl-4 pr-3 text-[13.5px] leading-6">
                    <span className={cn("absolute inset-y-2 left-0 w-[2px] rounded-full", status === "passed" ? "bg-ok" : status === "failed" ? "bg-bad" : status === "awaiting_approval" ? "bg-warn" : "bg-run")} />
                    {run.summary}
                  </div>
                )}
                <div className="grid grid-cols-3 divide-x divide-border rounded border border-border">
                  <Stat label="Started" value={fmtTime(run.started_at)} />
                  <Stat label="Duration" value={fmtDuration(run.started_at, run.ended_at) || "—"} />
                  <Stat label="Steps" value={String(run.logs.length)} />
                </div>
                <section>
                  <h4 className="label mb-2">Inputs</h4>
                  <KV data={run.inputs} />
                </section>
                <section>
                  <h4 className="label mb-2">Outputs</h4>
                  <KV data={run.outputs} />
                </section>
              </>
            )}
          </TabsContent>

          <TabsContent value="reasoning" className="space-y-3 p-4">
            {run?.reasoning && (
              <div className="whitespace-pre-wrap rounded border border-info/25 bg-info/[0.05] p-3 text-[13px] leading-6">
                <div className="label mb-1.5 text-info">Agent rationale</div>
                {run.reasoning}
              </div>
            )}
            {run?.logs.length ? (
              <div className="overflow-hidden rounded border border-border bg-bg">
                <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                  <span className="label">Trace</span>
                  <span className="tnum font-mono text-2xs text-faint">{run.logs.length} lines</span>
                </div>
                <div className="max-h-[460px] overflow-auto py-1.5 font-mono text-[11.5px] leading-[19px]">
                  {run.logs.map((l, i) => {
                    const lv = LEVEL[l.level] ?? { label: l.level, cls: "text-faint" };
                    return (
                      <div key={i} className="grid grid-cols-[62px_40px_1fr] gap-2 px-3 hover:bg-subtle/60">
                        <span className="tnum text-faint">{fmtClock(l.ts)}</span>
                        <span className={cn("uppercase", lv.cls)}>{lv.label}</span>
                        <span className={cn("min-w-0 whitespace-pre-wrap break-words", l.level === "thought" ? "text-muted" : "text-fg")}>{l.msg}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              !run?.reasoning && <Empty title="No agent activity yet" className="py-8" />
            )}
          </TabsContent>

          <TabsContent value="artifacts" className="space-y-3 p-4">
            {run?.artifacts.length ? run.artifacts.map((a, i) => <ArtifactView key={`${a.name}-${i}`} artifact={a} />) : <Empty title="No artifacts" className="py-8" />}
          </TabsContent>

          <TabsContent value="links" className="p-4">
            {run?.links.length ? (
              <ul className="divide-y divide-border overflow-hidden rounded border border-border">
                {run.links.map((l, i) => (
                  <li key={i}>
                    <a href={l.url} target="_blank" rel="noreferrer" className="group flex items-center gap-3 px-3 py-2.5 hover:bg-subtle/60">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-raised">
                        <ToolIcon tool={l.tool} size={13} className="group-hover:text-accent" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{l.label}</span>
                        <span className="block truncate font-mono text-2xs text-faint">{l.url}</span>
                      </span>
                      <span className="text-xs text-muted">{l.tool}</span>
                      <ArrowUpRight size={13} className="text-faint group-hover:text-accent" />
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="No external links" hint="Links to Jira, GitHub, IoT jobs and other tools appear here." className="py-8" />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-3 py-2">
      <div className="label">{label}</div>
      <div className="tnum mt-0.5 truncate text-sm text-fg">{value}</div>
    </div>
  );
}

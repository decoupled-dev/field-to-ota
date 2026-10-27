import { useMemo, useState } from "react";
import { api, type Integration } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { useApp } from "@/lib/context";
import { PageBody, PageHeader } from "@/components/layout/Page";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal, ModalClose } from "@/components/ui/sheet";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { ToolIcon } from "@/components/domain";
import { cn } from "@/lib/utils";

const GROUPS: { capability: string; title: string; description: string }[] = [
  { capability: "signal_source", title: "Signal sources", description: "Where field signals come from" },
  { capability: "issue_tracker", title: "Issue tracking", description: "Defect tickets and partner hand-off" },
  { capability: "source_control", title: "Source control", description: "Branches, patches and pull requests" },
  { capability: "ci", title: "CI / verification", description: "Unit tests and replay of field conditions" },
  { capability: "requirements_alm", title: "Requirements ALM", description: "Requirement changes and traceability" },
  { capability: "fleet_analytics", title: "Fleet analytics", description: "Telemetry queries and cohort selection" },
  { capability: "sim", title: "Simulation / HIL", description: "Reproduction environments" },
  { capability: "ota", title: "OTA delivery", description: "Signing and over-the-air rollout" },
  { capability: "notifier", title: "Notifications", description: "Field replies and team updates" },
  { capability: "llm", title: "Reasoning models", description: "Models behind the triage, root-cause and fix agents" },
];

const STATUS: Record<Integration["status"], { label: string; tone: "ok" | "warn" | "outline" }> = {
  connected: { label: "Connected", tone: "ok" },
  simulated: { label: "Simulated", tone: "warn" },
  available: { label: "Available", tone: "outline" },
};

export default function IntegrationsPage() {
  const ints = useAsync(api.integrations, []);
  const { stages } = useApp();
  const [cfg, setCfg] = useState<Integration | null>(null);
  const stageIndex = (k: string) => stages.findIndex((s) => s.key === k);
  const stageName = (k: string) => stages.find((s) => s.key === k)?.name ?? k;

  const groups = useMemo(() => {
    const data = ints.data ?? [];
    const known = GROUPS.map((g) => ({ ...g, items: data.filter((i) => i.capability === g.capability) }));
    const other = data.filter((i) => !GROUPS.some((g) => g.capability === i.capability));
    if (other.length) known.push({ capability: "other", title: "Other", description: "", items: other });
    return known.filter((g) => g.items.length);
  }, [ints.data]);

  const totals = useMemo(() => {
    const d = ints.data ?? [];
    return { connected: d.filter((i) => i.status === "connected").length, simulated: d.filter((i) => i.status === "simulated").length, available: d.filter((i) => i.status === "available").length };
  }, [ints.data]);

  return (
    <PageBody>
      <PageHeader
        title="Integrations"
        description="Every stage calls a connector through a capability interface. Swap in the OEM toolchain without changing the pipeline."
        actions={ints.data && <><Badge tone="ok">{totals.connected} connected</Badge><Badge tone="warn">{totals.simulated} simulated</Badge></>}
      />
      {ints.error && !ints.data ? (
        <ErrorState error={ints.error} onRetry={ints.reload} />
      ) : !ints.data ? (
        <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      ) : !groups.length ? (
        <Card><Empty title="No connectors registered" /></Card>
      ) : (
        <div className="space-y-px overflow-hidden rounded-md border border-border bg-border">
          {groups.map((g) => (
            <section key={g.capability} className="grid bg-surface lg:grid-cols-[240px_1fr]">
              <div className="border-b border-border px-4 py-4 lg:border-b-0 lg:border-r">
                <div className="text-sm font-semibold text-fg">{g.title}</div>
                <div className="mt-1 text-xs leading-5 text-muted">{g.description}</div>
                <div className="mt-2 font-mono text-[10px] text-faint">{g.capability}</div>
              </div>
              <div className="grid sm:grid-cols-2 2xl:grid-cols-3">
                {g.items.map((i) => (
                  <div key={i.key} className="flex flex-col bg-surface p-4 shadow-[inset_-1px_-1px_0_hsl(var(--border))]">
                    <div className="flex items-start gap-3">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-raised", i.status === "connected" ? "border-ok/40" : "border-border")}>
                        <ToolIcon tool={i.key.split("_")[0]} size={16} className={i.status === "connected" ? "text-ok" : undefined} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13.5px] font-semibold">{i.name}</span>
                          <Badge tone={STATUS[i.status]?.tone ?? "outline"}>{STATUS[i.status]?.label ?? i.status}</Badge>
                        </div>
                        <div className="text-xs text-faint">{i.vendor}</div>
                      </div>
                    </div>
                    <p className="mt-2.5 flex-1 text-xs leading-5 text-muted">{i.description}</p>
                    <div className="mt-3 flex items-end gap-2">
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                        {i.stages.map((s) => (
                          <span key={s} className="rounded-sm border border-border px-1.5 py-px font-mono text-[10px] text-muted">
                            <span className="text-faint">{String(stageIndex(s) + 1).padStart(2, "0")}</span> {stageName(s)}
                          </span>
                        ))}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setCfg(i)}>Configure</Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
      <Modal open={!!cfg} onOpenChange={(o) => !o && setCfg(null)} title={cfg ? `Configure ${cfg.name}` : ""} description="Credentials are stored in AWS Secrets Manager. Values are read by the connector at runtime.">
        {cfg && (
          <div className="space-y-4">
            <dl className="divide-y divide-border overflow-hidden rounded border border-border">
              {(cfg.config_keys?.length ? cfg.config_keys : [`${cfg.key.toUpperCase()}_URL`, `${cfg.key.toUpperCase()}_TOKEN`]).map((k) => (
                <div key={k} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="font-mono text-[12px]">{k}</dt>
                  <dd className={cn("text-xs", cfg.status === "connected" ? "text-ok" : "text-faint")}>{cfg.status === "connected" ? "set" : "not set"}</dd>
                </div>
              ))}
            </dl>
            <div className="text-xs text-faint">Capability · <span className="text-fg">{cfg.capability}</span></div>
            <div className="flex justify-end">
              <ModalClose asChild><Button size="sm" variant="secondary">Close</Button></ModalClose>
            </div>
          </div>
        )}
      </Modal>
    </PageBody>
  );
}

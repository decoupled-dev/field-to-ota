import { HeartPulse, Rocket, Car, ChartBar } from "lucide-react";
import { api, type Fleet } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, axis, grid, legend, tooltipProps } from "@/components/charts";
import { cn } from "@/lib/utils";

const AFFECTED = "hsl(var(--accent))";
const TOTAL = "hsl(var(--strong) / 0.6)";

export function FleetPanel({ caseId, refreshKey }: { caseId: string; refreshKey: unknown }) {
  const fleet = useAsync(() => api.fleet(caseId), [caseId, refreshKey], 5000);
  if (fleet.error && !fleet.data) return <ErrorState error={fleet.error} onRetry={fleet.reload} />;
  if (!fleet.data) return <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>;
  const f = fleet.data;
  if (!f.total_vins) return <Card><Empty title="No fleet analysis yet" hint="The Fleet Impact stage populates this view." /></Card>;
  return (
    <div className="space-y-5">
      <Rollout f={f} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Breakdown title="By region" data={f.by_region.map((r) => ({ name: r.region, affected: r.affected, total: r.total }))} />
        <Breakdown title="By SW version" data={f.by_version.map((r) => ({ name: r.sw_version, affected: r.affected, total: r.total }))} />
        <Breakdown title="By min. ambient" data={f.by_temp.map((r) => ({ name: r.bucket, affected: r.affected, total: r.total }))} />
      </div>
      <Card>
        <CardHeader icon={HeartPulse} title="Field health" description="Audio underruns per ignition across the cohort, before and after the OTA" />
        <CardBody>
          {f.health.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={f.health.map((h) => ({ ...h, label: new Date(h.t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="fh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="hsl(var(--accent))" stopOpacity={0.35} />
                    <stop offset="1" stopColor="hsl(var(--accent))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {grid}
                <XAxis dataKey="label" {...axis} minTickGap={40} />
                <YAxis {...axis} axisLine={false} allowDecimals={false} />
                <Tooltip {...tooltipProps} />
                <Area type="stepAfter" dataKey="underruns" name="Underruns / boot" stroke="hsl(var(--accent))" fill="url(#fh)" strokeWidth={1.75} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="No health reports yet" hint="hu-sentinel devices report health after each ignition cycle." />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader icon={Car} title="Affected cohort" description={`${f.affected_vins} of ${f.total_vins} vehicles match the signature`} />
        <div className="max-h-[420px] overflow-y-auto">
          <Table>
            <thead className="sticky top-0 z-10">
              <tr>
                <Th>VIN</Th>
                <Th>Region</Th>
                <Th>SW</Th>
                <Th className="text-right">Min temp</Th>
                <Th className="text-right">Underruns</Th>
                <Th>OTA</Th>
              </tr>
            </thead>
            <tbody>
              {f.cohort.map((v) => (
                <Tr key={v.vin}>
                  <Td className="font-mono text-[12px]">{v.vin}</Td>
                  <Td className="text-[12.5px]">{v.region}</Td>
                  <Td className="font-mono text-[12px]">{v.sw_version}</Td>
                  <Td className="tnum text-right font-mono text-[12px]">{v.min_temp_c.toFixed(1)} °C</Td>
                  <Td className={cn("tnum text-right font-mono text-[12px]", v.underruns > 0 ? "text-accent" : "text-ok")}>{v.underruns}</Td>
                  <Td><OtaBadge status={v.ota_status} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

function OtaBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  const tone = s === "succeeded" ? "ok" : s === "failed" ? "bad" : s === "in_progress" || s === "queued" ? "run" : "outline";
  return <Badge tone={tone}>{s.replace(/_/g, " ") || "not targeted"}</Badge>;
}

const CELLS = 80;

/** Rollout as a discrete cell bar: each cell is 1/80 of the targeted cohort. */
function Rollout({ f }: { f: Fleet }) {
  const r = f.rollout;
  const total = Math.max(1, r.targeted);
  const ok = Math.round((r.succeeded / total) * CELLS);
  const run = Math.round((r.in_progress / total) * CELLS);
  const bad = Math.round((r.failed / total) * CELLS);
  const pct = r.targeted ? Math.round((r.succeeded / total) * 100) : 0;
  const stats: [string, number, string][] = [
    ["Affected", f.affected_vins, "text-fg"],
    ["Targeted", r.targeted, "text-fg"],
    ["Succeeded", r.succeeded, "text-ok"],
    ["In progress", r.in_progress, "text-run"],
    ["Failed", r.failed, r.failed ? "text-bad" : "text-faint"],
  ];
  return (
    <Card>
      <CardHeader icon={Rocket} title="OTA rollout" description={r.targeted ? `Wave: ${r.wave}` : "Not started. Rollout begins after release approval."} />
      <div className="grid gap-6 p-4 lg:grid-cols-[220px_1fr]">
        <div>
          <div className="label">Fleet repaired</div>
          <div className="tnum mt-1 text-[44px] font-light leading-none tracking-[-0.04em]">
            {pct}<span className="ml-0.5 text-[22px] text-muted">%</span>
          </div>
          <div className="mt-2 text-xs text-faint">{r.succeeded} of {r.targeted || f.affected_vins} vehicles</div>
        </div>
        <div className="min-w-0">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${CELLS / 2}, minmax(0, 1fr))` }}>
            {Array.from({ length: CELLS }, (_, i) => (
              <span
                key={i}
                className={cn("h-3 rounded-[1px]", i < ok ? "bg-ok" : i < ok + run ? "animate-pulseSoft bg-run" : i < ok + run + bad ? "bg-bad" : "bg-subtle")}
              />
            ))}
          </div>
          <dl className="mt-4 grid grid-cols-5 divide-x divide-border border-t border-border pt-3">
            {stats.map(([k, v, cls]) => (
              <div key={k} className="px-3 first:pl-0">
                <dt className="label">{k}</dt>
                <dd className={cn("tnum mt-0.5 font-mono text-[18px]", cls)}>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Card>
  );
}

function Breakdown({ title, data }: { title: string; data: { name: string; affected: number; total: number }[] }) {
  return (
    <Card>
      <CardHeader icon={ChartBar} title={title} />
      <CardBody>
        {data.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.map((d) => ({ ...d, unaffected: Math.max(0, d.total - d.affected) }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              {grid}
              <XAxis dataKey="name" {...axis} interval={0} />
              <YAxis {...axis} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              {legend}
              <Bar dataKey="affected" name="Affected" stackId="a" fill={AFFECTED} maxBarSize={22} isAnimationActive={false} />
              <Bar dataKey="unaffected" name="Not affected" stackId="a" fill={TOTAL} radius={[1, 1, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty title="No data" />
        )}
      </CardBody>
    </Card>
  );
}

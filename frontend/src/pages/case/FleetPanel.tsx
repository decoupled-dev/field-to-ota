import { api, type Fleet } from "@/lib/api";
import { useAsync } from "@/lib/hooks";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty, ErrorState, Skeleton } from "@/components/ui/states";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, axis, grid, legend, tooltipProps } from "@/components/charts";

const AFFECTED = "#ef4444";
const TOTAL = "hsl(var(--border))";

export function FleetPanel({ caseId, refreshKey }: { caseId: string; refreshKey: unknown }) {
  const fleet = useAsync(() => api.fleet(caseId), [caseId, refreshKey], 5000);
  if (fleet.error && !fleet.data) return <ErrorState error={fleet.error} onRetry={fleet.reload} />;
  if (!fleet.data) return <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}</div>;
  const f = fleet.data;
  if (!f.total_vins) return <Empty title="No fleet analysis yet" hint="The Fleet Impact stage populates this view." />;
  return (
    <div className="space-y-6">
      <Rollout f={f} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Breakdown title="By region" data={f.by_region.map((r) => ({ name: r.region, affected: r.affected, total: r.total }))} />
        <Breakdown title="By SW version" data={f.by_version.map((r) => ({ name: r.sw_version, affected: r.affected, total: r.total }))} />
        <Breakdown title="By min. ambient temperature" data={f.by_temp.map((r) => ({ name: r.bucket, affected: r.affected, total: r.total }))} />
      </div>
      <Card>
        <CardHeader title="Field health" description="Audio underruns per ignition across the cohort, before and after the OTA" />
        <CardBody>
          {f.health.length ? (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={f.health.map((h) => ({ ...h, label: new Date(h.t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }))} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                {grid}
                <XAxis dataKey="label" {...axis} minTickGap={40} />
                <YAxis {...axis} axisLine={false} allowDecimals={false} />
                <Tooltip {...tooltipProps} />
                <Line type="monotone" dataKey="underruns" name="Underruns / boot" stroke="#2563eb" strokeWidth={1.75} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <Empty title="No health reports yet" hint="hu-sentinel devices report health after each ignition cycle." />
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Affected cohort" description={`${f.affected_vins} of ${f.total_vins} vehicles match the signature`} />
        <div className="max-h-[420px] overflow-y-auto">
          <Table>
            <thead className="sticky top-0 bg-surface">
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
                  <Td className="font-mono text-xs">{v.vin}</Td>
                  <Td>{v.region}</Td>
                  <Td className="font-mono text-xs">{v.sw_version}</Td>
                  <Td className="tnum text-right">{v.min_temp_c.toFixed(1)} °C</Td>
                  <Td className="tnum text-right">{v.underruns}</Td>
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
  return <Badge tone={tone} className="capitalize">{s.replace(/_/g, " ") || "not targeted"}</Badge>;
}

function Rollout({ f }: { f: Fleet }) {
  const r = f.rollout;
  const total = Math.max(1, r.targeted);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <Card>
      <CardHeader title="OTA rollout" description={r.targeted ? `Wave: ${r.wave}` : "Not started. Rollout begins after release approval."} />
      <CardBody>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border md:grid-cols-5">
          {[
            ["Affected", f.affected_vins],
            ["Targeted", r.targeted],
            ["Succeeded", r.succeeded],
            ["In progress", r.in_progress],
            ["Failed", r.failed],
          ].map(([k, v]) => (
            <div key={k} className="bg-surface px-3 py-2.5">
              <div className="text-xs text-muted">{k}</div>
              <div className="tnum text-xl font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-subtle">
          <div className="bg-ok" style={{ width: seg(r.succeeded) }} />
          <div className="animate-pulseSoft bg-run" style={{ width: seg(r.in_progress) }} />
          <div className="bg-bad" style={{ width: seg(r.failed) }} />
        </div>
      </CardBody>
    </Card>
  );
}

function Breakdown({ title, data }: { title: string; data: { name: string; affected: number; total: number }[] }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {data.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data.map((d) => ({ ...d, unaffected: Math.max(0, d.total - d.affected) }))} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              {grid}
              <XAxis dataKey="name" {...axis} interval={0} fontSize={10} />
              <YAxis {...axis} axisLine={false} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              {legend}
              <Bar dataKey="affected" name="Affected" stackId="a" fill={AFFECTED} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="unaffected" name="Not affected" stackId="a" fill={TOTAL} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Empty title="No data" />
        )}
      </CardBody>
    </Card>
  );
}

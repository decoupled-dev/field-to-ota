import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartContent } from "@/lib/api";

export const SERIES_COLORS = ["#2563eb", "#14b8a6", "#f59e0b", "#8b5cf6", "#ef4444", "#64748b"];

export const axis = {
  stroke: "hsl(var(--border))",
  tick: { fill: "hsl(var(--muted))", fontSize: 11 },
  tickLine: false,
} as const;

export const grid = <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="0" vertical={false} />;

export const tooltipProps = {
  contentStyle: {
    background: "hsl(var(--surface))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 6,
    fontSize: 12,
    color: "hsl(var(--fg))",
    boxShadow: "0 4px 12px rgb(0 0 0 / 0.08)",
  },
  labelStyle: { color: "hsl(var(--muted))", marginBottom: 4 },
  cursor: { fill: "hsl(var(--subtle))", stroke: "hsl(var(--border))" },
} as const;

const legend = <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted))" }} />;

/** Renders the generic chart artifact contract: {type, x, series, data}. */
export function ChartArtifact({ chart, height = 220 }: { chart: ChartContent; height?: number }) {
  const series = chart.series ?? [];
  return (
    <ResponsiveContainer width="100%" height={height}>
      {chart.type === "line" ? (
        <LineChart data={chart.data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          {grid}
          <XAxis dataKey={chart.x} {...axis} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip {...tooltipProps} />
          {series.length > 1 && legend}
          {series.map((s, i) => (
            <Line key={s.key} dataKey={s.key} name={s.label} stroke={SERIES_COLORS[i % SERIES_COLORS.length]} strokeWidth={1.75} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      ) : (
        <BarChart data={chart.data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          {grid}
          <XAxis dataKey={chart.x} {...axis} />
          <YAxis {...axis} axisLine={false} allowDecimals={false} />
          <Tooltip {...tooltipProps} />
          {series.length > 1 && legend}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[2, 2, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

export { Area, AreaChart, Bar, BarChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, legend };

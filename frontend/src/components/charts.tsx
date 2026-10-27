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

// Ordered for adjacent contrast on both themes; accent first so a single series reads as "the signal".
export const SERIES_COLORS = ["hsl(var(--accent))", "#2898BD", "#8F7EE7", "hsl(var(--ok))", "#E2B203", "#8590A2"];

export const axis = {
  stroke: "hsl(var(--border))",
  tick: { fill: "hsl(var(--faint))", fontSize: 10, fontFamily: "Inter, system-ui, sans-serif" },
  tickLine: false,
} as const;

export const grid = <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />;

export const tooltipProps = {
  contentStyle: {
    background: "hsl(var(--raised))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "Inter, system-ui, sans-serif",
    color: "hsl(var(--fg))",
    boxShadow: "0 8px 12px rgb(9 30 66 / 0.15), 0 0 1px rgb(9 30 66 / 0.31)",
    padding: "6px 10px",
  },
  labelStyle: { color: "hsl(var(--muted))", marginBottom: 4, fontWeight: 600 },
  itemStyle: { padding: 0 },
  cursor: { fill: "hsl(var(--fg) / 0.04)", stroke: "hsl(var(--strong))" },
} as const;

const legend = (
  <Legend
    iconType="square"
    iconSize={7}
    wrapperStyle={{ fontSize: 10, color: "hsl(var(--muted))", fontFamily: "Inter, system-ui, sans-serif", textTransform: "uppercase", letterSpacing: "0.06em", paddingTop: 6 }}
  />
);

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
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={[1, 1, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

export { Area, AreaChart, Bar, BarChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, legend };

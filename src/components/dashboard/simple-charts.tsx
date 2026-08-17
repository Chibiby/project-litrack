"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LabelList,
  LineChart,
  Line,
} from "recharts";

type Point = { name?: string; date?: string; value: number };

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
};

export function DashboardBarChart({
  data,
  color = "hsl(var(--primary))",
  height = 220,
}: {
  data: Point[];
  color?: string;
  height?: number;
}) {
  const keyed = data.map((d) => ({
    label: d.name ?? d.date ?? "",
    value: d.value,
  }));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={keyed} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            interval={0}
            angle={keyed.length > 4 ? -25 : 0}
            textAnchor={keyed.length > 4 ? "end" : "middle"}
            height={keyed.length > 4 ? 56 : 30}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
          <Tooltip contentStyle={tooltipStyle} />
          <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Learners per grade level for the teacher dashboard.
 *
 * Differs from DashboardBarChart in three ways the approved design calls for:
 * the value sits above each bar so the figure is readable without hovering
 * (which a touch user cannot do at all), the axis is violet to key the chart to
 * the ARAL accent, and zero-value grades still render their label so the
 * distribution reads against the school's whole grade ladder.
 */
export function GradeLevelBarChart({
  data,
  height = 260,
}: {
  data: { name: string; value: number }[];
  /** Accepts "100%" so the chart can fill a card stretched by its grid row. */
  height?: number | string;
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  // Round the axis up to a clean ceiling so the tallest bar never touches the
  // top of the plot and the labels above it always have room.
  const step = max <= 8 ? 2 : max <= 20 ? 4 : Math.ceil(max / 5);
  const ceiling = Math.max(Math.ceil((max + step / 2) / step) * step, step * 2);
  const ticks = Array.from(
    { length: Math.floor(ceiling / step) + 1 },
    (_, i) => i * step
  );

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsl(var(--border))"
          />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={{ stroke: "hsl(var(--border))" }}
            interval={0}
          />
          <YAxis
            allowDecimals={false}
            domain={[0, ceiling]}
            ticks={ticks}
            tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{
              ...tooltipStyle,
              background: "hsl(var(--popover))",
              color: "hsl(var(--popover-foreground))",
            }}
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
            formatter={(value) => [`${Number(value ?? 0)} learners`, ""]}
          />
          <Bar
            dataKey="value"
            fill="hsl(var(--violet))"
            radius={[6, 6, 0, 0]}
            maxBarSize={56}
          >
            <LabelList
              dataKey="value"
              position="top"
              offset={8}
              style={{
                fontSize: 12,
                fontWeight: 600,
                fill: "hsl(var(--foreground))",
              }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardLineChart({
  data,
  color = "hsl(var(--primary))",
  height = 220,
}: {
  data: Point[];
  color?: string;
  height?: number;
}) {
  const keyed = data.map((d) => ({
    label: d.name ?? d.date ?? "",
    value: d.value,
  }));

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={keyed} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={32} />
          <Tooltip contentStyle={tooltipStyle} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

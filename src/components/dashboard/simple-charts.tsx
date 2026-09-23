"use client";

import { useSyncExternalStore } from "react";
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type Point = { name?: string; date?: string; value: number };

const tooltipStyle = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
};

const PHONE_QUERY = "(max-width: 639px)";

function subscribePhone(onChange: () => void): () => void {
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True below `sm`. The server snapshot is false, so tablet and desktop never change. */
function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
}

/** Phone-width category label: long reading-level names clipped so angled ticks stay inside the card. */
function clipTick(label: string): string {
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

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
  const isPhone = useIsPhone();
  const angled = keyed.length > 4;
  // Phones only: at -25° the long reading-level names ran off the card's left
  // edge and into each other. Steeper, clipped and given more room instead.
  const phoneTicks = isPhone && angled;

  return (
    <div className="w-full" style={{ height: phoneTicks ? height + 24 : height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={keyed}
          margin={{ top: 8, right: 8, left: phoneTicks ? 12 : 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: phoneTicks ? 10 : 11 }}
            interval={0}
            angle={phoneTicks ? -50 : angled ? -25 : 0}
            textAnchor={angled ? "end" : "middle"}
            height={phoneTicks ? 80 : angled ? 56 : 30}
            tickFormatter={phoneTicks ? clipTick : undefined}
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
/** Phone-width axis label: "Grade 3" → "G3", "Kinder" → "K"; anything else unchanged. */
export function shortGradeLabel(label: string): string {
  if (label === "Kinder") return "K";
  const m = /^Grade (\d+)$/.exec(label);
  return m ? `G${m[1]}` : label;
}

export function GradeLevelBarChart({
  data,
  height = 260,
  shortLabels = false,
}: {
  data: { name: string; value: number }[];
  /** Accepts "100%" so the chart can fill a card stretched by its grid row. */
  height?: number | string;
  /** Abbreviate axis labels so every grade fits at phone width. */
  shortLabels?: boolean;
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
            {...(shortLabels ? { tickFormatter: shortGradeLabel } : {})}
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

/**
 * Slice palette for categorical pies. Violet is deliberately absent — it is
 * reserved for ARAL — so theme tokens lead and fixed hues fill the rest.
 */
const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "hsl(160 70% 40%)",
  "hsl(350 75% 55%)",
  "hsl(190 80% 42%)",
  "hsl(20 85% 52%)",
  "hsl(215 16% 47%)",
];

export function DashboardPieChart({
  data,
  height = 260,
}: {
  data: { name: string; value: number }[];
  height?: number;
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            outerRadius="70%"
            label={{ fontSize: 11 }}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell key={d.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
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

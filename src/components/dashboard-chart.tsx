"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type ChartDatum = { name: string; value: number };

export function DashboardBarChart({
  title,
  description,
  data,
  emptyMessage = "No data to chart yet.",
  valueLabel = "Count",
}: {
  title: string;
  description?: string;
  data: ChartDatum[];
  emptyMessage?: string;
  valueLabel?: string;
}) {
  const hasData = data.some((d) => d.value > 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-4 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <div className="h-56 w-full" role="img" aria-label={`${title}: ${valueLabel} by category`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    borderRadius: "0.5rem",
                    border: "1px solid hsl(var(--border))",
                    background: "hsl(var(--card))",
                  }}
                  labelFormatter={(label) => String(label)}
                />
                <Bar dataKey="value" name={valueLabel} fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

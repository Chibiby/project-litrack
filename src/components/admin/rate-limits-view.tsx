"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Gauge } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { setRateLimitsPaused } from "@/lib/actions/rate-limits";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import {
  RATE_LIMIT_SCOPE_LABELS,
  RATE_LIMIT_SCOPE_ORDER,
  formatRateWindow,
  formatRateWindowShort,
  type RateLimitScope,
} from "@/lib/rate-limits/catalog";

export type RateLimitRow = {
  id: string;
  limit: number;
  windowMs: number;
  label: string;
  description: string;
  scope: RateLimitScope;
  per: string;
};

function allowance(row: RateLimitRow): string {
  return `${row.limit} per ${formatRateWindow(row.windowMs)}`;
}

/** Phone value slot: "10 / 5 min", so the limit's name is not cut short. */
function shortAllowance(row: RateLimitRow): string {
  return `${row.limit} / ${formatRateWindowShort(row.windowMs)}`;
}

function ScopeTable({ rows }: { rows: RateLimitRow[] }) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Limit</TableHead>
          <TableHead>Counted per</TableHead>
          <TableHead numeric>Allowed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-[28rem]">
              <p className="font-medium">{row.label}</p>
              <p className="text-sm text-muted-foreground">{row.description}</p>
            </TableCell>
            <TableCell className="text-sm">{row.per}</TableCell>
            <TableCell numeric>{allowance(row)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const stacked = (
    <StackedList>
      {rows.map((row) => (
        <StackedRow
          key={row.id}
          title={row.label}
          value={shortAllowance(row)}
          meta={`Per ${row.per} · ${allowance(row)}`}
          details={[{ label: "What it limits", value: row.description }]}
        />
      ))}
    </StackedList>
  );

  return <ResponsiveTable table={table} stacked={stacked} />;
}

/**
 * Developer Controls → Rate limits: the pause switch, then every limit grouped
 * by what it counts against, same-network limits first.
 */
export function RateLimitsView({
  rows,
  paused,
  codePaused,
}: {
  rows: RateLimitRow[];
  paused: boolean;
  codePaused: boolean;
}) {
  const [saving, startSave] = useTransition();
  const off = paused || codePaused;

  const toggle = (next: boolean) => {
    const formData = new FormData();
    formData.set("paused", next ? "true" : "false");
    startSave(async () => {
      const res = await callAction(() => setRateLimitsPaused(formData));
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(
        next
          ? "Rate limits paused. Turn them back on as soon as the group is done."
          : "Rate limits are back on."
      );
    });
  };

  return (
    <div className="space-y-6">
      <Surface
        as="section"
        className={
          off
            ? "min-w-0 space-y-3 rounded-lg border-warning-300 bg-warning-50 p-4 text-warning-950 sm:p-6 dark:border-warning-500/40 dark:bg-warning-950/40 dark:text-warning-100"
            : "min-w-0 space-y-3 rounded-lg p-4 sm:p-6"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {off ? (
                <AlertTriangle className="h-5 w-5" aria-hidden />
              ) : (
                <Gauge className="h-5 w-5" aria-hidden />
              )}
              {off ? "All rate limits are paused" : "Rate limits are on"}
            </h2>
            <p className="mt-1 text-sm">
              {off
                ? "Every attempt is allowed, so many people on one network can sign up and sign in at once. Password guessing is not slowed down either. Turn the limits back on as soon as you can."
                : "Pause them only while a large group signs up or signs in from one network, such as a training room on one Wi-Fi. Pausing also removes the protection against password guessing."}
            </p>
            {codePaused ? (
              <p className="mt-2 text-sm font-medium">
                The code-level switch RATE_LIMITS_PAUSED is on, so this page cannot turn the limits
                back on. Set it to false and deploy.
              </p>
            ) : null}
          </div>
          <Badge variant={off ? "outline" : "secondary"}>{off ? "Paused" : "On"}</Badge>
        </div>
        {codePaused ? null : (
          <Button
            type="button"
            variant={paused ? "default" : "outline"}
            loading={saving}
            loadingText="Saving…"
            onClick={() => toggle(!paused)}
          >
            {paused ? "Turn rate limits back on" : "Pause all rate limits"}
          </Button>
        )}
        <p className="text-xs opacity-80">A change reaches every server within about 10 seconds.</p>
      </Surface>

      {RATE_LIMIT_SCOPE_ORDER.map((scope) => {
        const scoped = rows.filter((r) => r.scope === scope);
        if (scoped.length === 0) return null;
        return (
          <Surface as="section" key={scope} className="min-w-0 space-y-3 rounded-lg p-4 sm:p-6">
            <h2 className="text-lg font-semibold">{RATE_LIMIT_SCOPE_LABELS[scope]}</h2>
            {scope === "network" ? (
              <p className="text-sm text-muted-foreground">
                Everyone on one Wi-Fi or school network usually shares one IP address, so these
                counters are shared by the whole room.
              </p>
            ) : null}
            <ScopeTable rows={scoped} />
          </Surface>
        );
      })}
    </div>
  );
}

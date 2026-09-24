"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useListNavigate } from "@/components/nav/list-navigation";
import { TERM_PERIOD_LABELS } from "@/lib/constants/enum-labels";
import { monthLabel, shiftMonth } from "@/lib/summary/shape/months";
import type { SummaryFacetMeta } from "@/lib/summary/facet-meta";
import { summaryHref, type FlatSearchParams } from "./summary-href";

/** Mirrors `MAX_SUMMARY_MONTHS` in the summary validator. */
const MAX_MONTHS = 12;

export type SummaryParamControlsProps = {
  basePath: string;
  searchParams: FlatSearchParams;
  kinds: SummaryFacetMeta["paramKinds"];
  /** The params the facet actually used, defaults filled in. */
  params: Record<string, string | null>;
  /** `YYYY-MM`, newest first. */
  monthOptions: readonly string[];
  schoolYearLabels?: readonly string[];
};

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id} className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function MonthSelect({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string | null;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const list = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Choose a month" />
      </SelectTrigger>
      <SelectContent>
        {list.map((m) => (
          <SelectItem key={m} value={m}>
            {monthLabel(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function monthsApart(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0));
}

/**
 * The facet's own period controls (month, month range, school year and term).
 * A range change that would break the 12-month limit or run backwards moves
 * the other end instead of producing a URL the facet would reject.
 */
export function SummaryParamControls({
  basePath,
  searchParams,
  kinds,
  params,
  monthOptions,
  schoolYearLabels = [],
}: SummaryParamControlsProps) {
  const navigate = useListNavigate();
  if (kinds.length === 0) return null;

  function go(patch: Record<string, string | null>) {
    navigate(summaryHref(basePath, searchParams, patch));
  }

  const from = params.from ?? null;
  const to = params.to ?? null;

  function changeFrom(next: string) {
    let nextTo = to ?? next;
    if (nextTo < next) nextTo = next;
    if (monthsApart(next, nextTo) >= MAX_MONTHS) nextTo = shiftMonth(next, MAX_MONTHS - 1);
    go({ from: next, to: nextTo });
  }

  function changeTo(next: string) {
    let nextFrom = from ?? next;
    if (nextFrom > next) nextFrom = next;
    if (monthsApart(nextFrom, next) >= MAX_MONTHS) nextFrom = shiftMonth(next, -(MAX_MONTHS - 1));
    go({ from: nextFrom, to: next });
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
      {kinds.includes("month") ? (
        <div className="lg:w-48">
          <Field id="summary-month" label="Month">
            <MonthSelect
              id="summary-month"
              value={params.month ?? null}
              options={monthOptions}
              onChange={(m) => go({ month: m })}
            />
          </Field>
        </div>
      ) : null}

      {kinds.includes("monthRange") ? (
        <>
          <div className="lg:w-48">
            <Field id="summary-from" label="From">
              <MonthSelect id="summary-from" value={from} options={monthOptions} onChange={changeFrom} />
            </Field>
          </div>
          <div className="lg:w-48">
            <Field id="summary-to" label="To">
              <MonthSelect id="summary-to" value={to} options={monthOptions} onChange={changeTo} />
            </Field>
          </div>
        </>
      ) : null}

      {kinds.includes("schoolYearTerm") ? (
        <>
          <div className="lg:w-48">
            <Field id="summary-school-year" label="School year">
              <Select
                value={params.schoolYearLabel ?? undefined}
                onValueChange={(v) => go({ schoolYearLabel: v })}
                disabled={schoolYearLabels.length === 0}
              >
                <SelectTrigger id="summary-school-year">
                  <SelectValue
                    placeholder={schoolYearLabels.length === 0 ? "No school years" : "Choose a school year"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {schoolYearLabels.map((label) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="lg:w-48">
            <Field id="summary-term" label="Term">
              <Select value={params.term ?? undefined} onValueChange={(v) => go({ term: v })}>
                <SelectTrigger id="summary-term">
                  <SelectValue placeholder="Choose a term" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TERM_PERIOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </>
      ) : null}
    </div>
  );
}

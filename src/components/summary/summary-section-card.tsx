import { BarChart3, Calculator, ListChecks, PieChart, TrendingUp, type LucideIcon } from "lucide-react";
import { DashboardBarChart, DashboardLineChart } from "@/components/dashboard/lazy-charts";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cellOf } from "@/lib/summary/shape/rollup";
import { NOT_ANSWERED, NOT_APPLICABLE, NOT_COLLECTED, NO_RECORD } from "@/lib/summary/shape/section";
import type { SummaryGroup, SummaryLevel, SummarySection } from "@/lib/summary/types";
import { SummaryTable } from "./summary-table";
import { sectionAnchorId } from "./summary-href";

const KIND_ICON: Record<SummarySection["kind"], LucideIcon> = {
  single: PieChart,
  multi: ListChecks,
  rate: TrendingUp,
  average: Calculator,
};

const ROW_HEADER: Record<SummaryLevel, string> = {
  overall: "Scope",
  district: "District",
  school: "School",
};

function overallTotal(section: SummarySection): SummaryGroup | null {
  const totals = section.table.groups.filter((g) => !g.gradeType);
  return totals.length === 1 ? totals[0]! : null;
}

/** Buckets that mean "no figure", not a real level — they dominate the scale and are chart-only noise. Kept in the table. */
const NO_DATA_BUCKET_IDS = new Set<string>([NOT_ANSWERED, NOT_APPLICABLE, NOT_COLLECTED, NO_RECORD]);

function isEmpty(section: SummarySection): boolean {
  if (section.buckets.length === 0) return true;
  return section.table.groups.every(
    (g) => g.base === 0 && Object.values(g.cells).every((c) => c.count === 0 && c.base === 0)
  );
}

/**
 * A chart only where it reads faster than the table: the overall distribution
 * of a single-choice question, and the attendance rate over time. The table
 * beside it carries the same figures for screen readers, so the chart is
 * hidden from them.
 */
function SectionChart({ section, level }: { section: SummarySection; level: SummaryLevel }) {
  if (level !== "overall") return null;
  const total = overallTotal(section);
  if (!total || total.base === 0) return null;

  if (section.kind === "rate" && section.buckets.length >= 2) {
    const data = section.buckets.map((b) => ({ name: b.label, value: cellOf(total, b.id).pct ?? 0 }));
    return (
      <div aria-hidden className="mb-4 min-w-0">
        <DashboardLineChart data={data} height={200} tickFontSize={12} />
      </div>
    );
  }

  if (section.kind !== "single") return null;
  const buckets = section.buckets.filter((b) => !NO_DATA_BUCKET_IDS.has(b.id));
  if (buckets.length > 10) return null;
  const data = buckets.map((b) => ({ name: b.label, value: cellOf(total, b.id).count }));
  if (data.filter((d) => d.value > 0).length < 2) return null;
  return (
    <div aria-hidden className="mb-4 min-w-0">
      <DashboardBarChart data={data} horizontal />
    </div>
  );
}

export function SummarySectionCard({
  section,
  level,
}: {
  section: SummarySection;
  level: SummaryLevel;
}) {
  const kindNote =
    section.kind === "single"
      ? "Each row adds up to 100%."
      : section.kind === "multi"
        ? "One can be counted in more than one column, so rows do not add up to 100%."
        : null;

  const Icon = KIND_ICON[section.kind];

  return (
    <section
      id={sectionAnchorId(section.id)}
      aria-labelledby={`${sectionAnchorId(section.id)}-title`}
      className="min-w-0 scroll-mt-24 rounded-2xl border border-border/80 bg-card text-card-foreground shadow-card"
    >
      <div className="flex items-start gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200"
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${sectionAnchorId(section.id)}-title`} className="text-base font-semibold tracking-tight">
            {section.title}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {section.baseLabel}
            {kindNote ? `. ${kindNote}` : ""}
          </p>
          {section.note ? <p className="mt-1.5 text-xs text-muted-foreground">{section.note}</p> : null}
        </div>
      </div>
      <div className="min-w-0 p-3 sm:p-5">
        {isEmpty(section) ? (
          <EmptyState
            icon={BarChart3}
            title="Nothing recorded yet"
            description="No figures exist for this table in the chosen scope and period."
            className="py-8"
          />
        ) : (
          <>
            <SectionChart section={section} level={level} />
            <SummaryTable section={section} rowHeader={ROW_HEADER[level]} />
          </>
        )}
      </div>
    </section>
  );
}

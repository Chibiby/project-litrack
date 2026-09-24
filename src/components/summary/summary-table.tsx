import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { cellOf } from "@/lib/summary/shape/rollup";
import { NOT_COLLECTED } from "@/lib/summary/shape/section";
import type { SummaryBucket, SummaryGroup, SummarySection } from "@/lib/summary/types";
import { formatCount, formatMean, formatPct } from "./summary-format";

type Block = { total: SummaryGroup; grades: SummaryGroup[] };

/**
 * Rollup emits each level row's grade rows first and its "All grades" total
 * last. The table shows the total first, with the grades under it.
 */
function toBlocks(groups: readonly SummaryGroup[]): Block[] {
  const blocks: Block[] = [];
  let pending: SummaryGroup[] = [];
  for (const group of groups) {
    if (group.gradeType) {
      pending.push(group);
      continue;
    }
    blocks.push({ total: group, grades: pending });
    pending = [];
  }
  for (const orphan of pending) blocks.push({ total: orphan, grades: [] });
  return blocks;
}

/** A "Not collected" column that is empty in every row says nothing; drop it. */
function visibleBuckets(section: SummarySection): SummaryBucket[] {
  return section.buckets.filter(
    (b) =>
      b.id !== NOT_COLLECTED ||
      section.table.groups.some((g) => cellOf(g, b.id).count > 0)
  );
}

function isNotCollectedRow(group: SummaryGroup): boolean {
  return (
    Boolean(group.gradeType) &&
    group.base > 0 &&
    cellOf(group, NOT_COLLECTED).count === group.base
  );
}

function hasTotalColumn(kind: SummarySection["kind"]): boolean {
  return kind === "single" || kind === "multi";
}

function Cell({
  section,
  group,
  bucket,
}: {
  section: SummarySection;
  group: SummaryGroup;
  bucket: SummaryBucket;
}) {
  const cell = cellOf(group, bucket.id);
  const override =
    group.gradeType && section.gradeBucketLabels?.[group.gradeType]?.[bucket.id];
  const gradeLabel = override && override !== bucket.label ? override : null;

  let primary: string;
  let secondary: string;
  if (section.kind === "rate") {
    primary = formatPct(cell.pct);
    secondary = `${formatCount(cell.count)} of ${formatCount(cell.base)}`;
  } else if (section.kind === "average") {
    primary = cell.base > 0 ? `Avg ${formatMean(cell.mean)}` : "—";
    secondary =
      cell.base > 0 ? `80+: ${formatCount(cell.count)} (${formatPct(cell.pct)})` : "No grades";
  } else {
    primary = formatCount(cell.count);
    secondary = formatPct(cell.pct);
  }

  return (
    <td
      className={cn(
        "border-b border-border/60 px-3 py-2.5 text-right align-top tabular-nums",
        cell.count === 0 && section.kind !== "average" && "text-muted-foreground"
      )}
    >
      <span className="block text-sm font-medium">{primary}</span>
      <span className="block text-xs text-muted-foreground">{secondary}</span>
      {gradeLabel ? (
        <span className="mt-0.5 block text-xs italic text-muted-foreground">{gradeLabel}</span>
      ) : null}
    </td>
  );
}

function Row({
  section,
  group,
  buckets,
  indent,
  isTotalOfGrades,
}: {
  section: SummarySection;
  group: SummaryGroup;
  buckets: SummaryBucket[];
  indent: boolean;
  isTotalOfGrades: boolean;
}) {
  const notCollected = isNotCollectedRow(group);
  return (
    <tr className={cn(isTotalOfGrades && "bg-muted/30")} data-group-key={group.key}>
      <th
        scope="row"
        className={cn(
          "sticky left-0 z-10 min-w-[10rem] max-w-[16rem] border-b border-r border-border/60 px-3 py-2.5 text-left align-top text-sm font-normal",
          isTotalOfGrades ? "bg-muted" : "bg-card",
          indent && "pl-7"
        )}
      >
        {indent ? (
          <span className="block text-foreground">{group.gradeLabel ?? group.gradeType}</span>
        ) : (
          <>
            <span className="block font-semibold text-foreground">{group.label}</span>
            {section.byGrade && group.gradeLabel ? (
              <span className="block text-xs text-muted-foreground">{group.gradeLabel}</span>
            ) : null}
          </>
        )}
      </th>
      {hasTotalColumn(section.kind) ? (
        <td className="border-b border-border/60 px-3 py-2.5 text-right align-top text-sm font-medium tabular-nums">
          {formatCount(group.base)}
        </td>
      ) : null}
      {notCollected ? (
        <td
          colSpan={buckets.length}
          className="border-b border-border/60 px-3 py-2.5 align-top text-sm italic text-muted-foreground"
        >
          Not collected for this grade
        </td>
      ) : (
        buckets.map((bucket) => (
          <Cell key={bucket.id} section={section} group={group} bucket={bucket} />
        ))
      )}
    </tr>
  );
}

export type SummaryTableProps = {
  section: SummarySection;
  /** First column heading, e.g. "District" or "School". */
  rowHeader?: string;
};

/**
 * Count and % cells for one summary section, first column pinned. Wide tables
 * scroll inside the `Table` primitive's own box, so the page itself never
 * scrolls sideways.
 */
export function SummaryTable({ section, rowHeader = "Group" }: SummaryTableProps) {
  const buckets = visibleBuckets(section);
  const blocks = toBlocks(section.table.groups);
  const totalHeader = section.kind === "multi" ? "Population" : "Total";

  return (
    <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border/60">
      <Table className="border-separate border-spacing-0">
        <caption className="sr-only">
          {section.title}. {section.baseLabel}
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-20 border-b border-r border-border/60 bg-card px-3 py-2.5 text-left align-bottom text-xs font-semibold text-muted-foreground"
            >
              {section.byGrade ? `${rowHeader} / grade` : rowHeader}
            </th>
            {hasTotalColumn(section.kind) ? (
              <th
                scope="col"
                className="border-b border-border/60 bg-card px-3 py-2.5 text-right align-bottom text-xs font-semibold text-muted-foreground"
              >
                {totalHeader}
              </th>
            ) : null}
            {buckets.map((bucket) => (
              <th
                key={bucket.id}
                scope="col"
                className="min-w-[7rem] max-w-[11rem] border-b border-border/60 bg-card px-3 py-2.5 text-right align-bottom text-xs font-semibold text-muted-foreground"
              >
                {bucket.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {blocks.map((block) => (
            <BlockRows key={block.total.key} section={section} block={block} buckets={buckets} />
          ))}
        </tbody>
      </Table>
    </div>
  );
}

function BlockRows({
  section,
  block,
  buckets,
}: {
  section: SummarySection;
  block: Block;
  buckets: SummaryBucket[];
}) {
  const hasGrades = block.grades.length > 0;
  return (
    <>
      <Row
        section={section}
        group={block.total}
        buckets={buckets}
        indent={false}
        isTotalOfGrades={hasGrades}
      />
      {block.grades.map((grade) => (
        <Row
          key={grade.key}
          section={section}
          group={grade}
          buckets={buckets}
          indent
          isTotalOfGrades={false}
        />
      ))}
    </>
  );
}

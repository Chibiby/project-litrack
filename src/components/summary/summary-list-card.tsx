import { CheckCircle2, School } from "lucide-react";
import { NoValue, Table } from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { cn } from "@/lib/utils";
import type { SummaryList } from "@/lib/summary/types";
import { sectionAnchorId } from "./summary-href";

type Cell = SummaryList["rows"][number][number];

/** Index of the row's last numeric cell, or -1. It becomes the phone row's value slot. */
function lastNumericIndex(row: readonly Cell[]): number {
  for (let j = row.length - 1; j > 0; j--) if (typeof row[j] === "number") return j;
  return -1;
}

/** A plain list printed beside the tables: schools flagged, schools with no attendance. */
export function SummaryListCard({ list }: { list: SummaryList }) {
  const anchor = sectionAnchorId(`list-${list.id}`);
  // A column is numeric when every filled cell in it is a number; its header aligns right.
  const numericColumns = list.columns.map((_, j) => {
    const filled = list.rows.map((row) => row[j]).filter((v) => v !== null && v !== undefined);
    return filled.length > 0 && filled.every((v) => typeof v === "number");
  });
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="min-w-0 scroll-mt-24 rounded-lg border border-border/80 bg-card text-card-foreground shadow-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-md",
            list.rows.length > 0
              ? "icon-glass text-warning-strong"
              : "icon-glass text-success-strong"
          )}
        >
          {list.rows.length > 0 ? <School className="size-5" /> : <CheckCircle2 className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`${anchor}-title`} className="text-base font-semibold tracking-tight">
            {list.title}
          </h2>
          {list.note ? <p className="mt-0.5 text-sm text-muted-foreground">{list.note}</p> : null}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
            list.rows.length > 0
              ? "bg-secondary/20 text-secondary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {list.rows.length}
        </span>
      </div>
      <div className="min-w-0 p-3 sm:p-5">
        {list.rows.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            No schools in this list.
          </p>
        ) : (
          <ResponsiveTable
            table={
              <div className="max-h-96 w-full min-w-0 overflow-auto rounded-lg border border-border/60">
                <Table className="border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {list.columns.map((column, j) => (
                        <th
                          key={column}
                          scope="col"
                          className={cn(
                            "sticky top-0 z-10 whitespace-nowrap border-b border-border/60 bg-card px-3 py-2.5 text-xs font-semibold text-muted-foreground",
                            numericColumns[j] ? "text-right" : "text-left"
                          )}
                        >
                          {column}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((row, i) => (
                      <tr key={i} className="transition-colors hover:bg-muted/40">
                        {row.map((value, j) => (
                          <td
                            key={j}
                            className={cn(
                              "border-b border-border/60 px-3 py-2.5 align-top",
                              j === 0 ? "min-w-48 font-medium text-foreground" : "text-muted-foreground",
                              typeof value === "number" && "whitespace-nowrap text-right tabular-nums"
                            )}
                          >
                            {value ?? <NoValue />}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            }
            stacked={
              <div className="max-h-96 overflow-auto rounded-lg border border-border/60">
                <StackedList aria-label={list.title}>
                  {list.rows.map((row, i) => {
                    const valueIndex = lastNumericIndex(row);
                    return (
                      <StackedRow
                        key={i}
                        title={String(row[0] ?? "—")}
                        value={
                          valueIndex > 0 ? (
                            <>
                              {row[valueIndex]}
                              <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {list.columns[valueIndex]}
                              </span>
                            </>
                          ) : undefined
                        }
                        details={row
                          .map((value, j) => ({ j, value }))
                          .filter(({ j }) => j !== 0 && j !== valueIndex)
                          .map(({ j, value }) => ({
                            label: list.columns[j] ?? "",
                            value: value ?? <NoValue />,
                          }))}
                      />
                    );
                  })}
                </StackedList>
              </div>
            }
          />
        )}
      </div>
    </section>
  );
}

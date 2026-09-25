import { CheckCircle2, School } from "lucide-react";
import { Table } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SummaryList } from "@/lib/summary/types";
import { sectionAnchorId } from "./summary-href";

/** A plain list printed beside the tables: schools flagged, schools with no attendance. */
export function SummaryListCard({ list }: { list: SummaryList }) {
  const anchor = sectionAnchorId(`list-${list.id}`);
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="min-w-0 scroll-mt-24 rounded-2xl border border-border/80 bg-card text-card-foreground shadow-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-5">
        <span
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            list.rows.length > 0
              ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
              : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
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
          <div className="max-h-96 w-full min-w-0 overflow-auto rounded-lg border border-border/60">
            <Table className="border-separate border-spacing-0">
              <thead>
                <tr>
                  {list.columns.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="whitespace-nowrap border-b border-border/60 bg-card px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((value, j) => (
                      <td
                        key={j}
                        className={cn(
                          "border-b border-border/60 px-3 py-2.5 align-top",
                          j === 0 ? "min-w-[12rem] font-medium text-foreground" : "text-muted-foreground",
                          typeof value === "number" && "text-right tabular-nums"
                        )}
                      >
                        {value ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </section>
  );
}

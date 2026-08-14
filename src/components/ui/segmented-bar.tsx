import { cn } from "@/lib/utils";

export interface BarSegment {
  label: string;
  value: number;
  /** Fill class for the bar slice, e.g. "bg-emerald-500". */
  className: string;
  /** Dot class for the legend swatch (usually the same color). */
  dotClassName: string;
}

/** Whole-percent share; 0 rather than NaN when the total is empty. */
export function percentOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function sum(segments: BarSegment[]): number {
  return segments.reduce((acc, s) => acc + s.value, 0);
}

export function SegmentedBar({
  segments,
  className,
}: {
  segments: BarSegment[];
  className?: string;
}) {
  const total = sum(segments);
  const summary = segments
    .map((s) => `${s.label} ${s.value} (${percentOf(s.value, total)}%)`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={summary}
      className={cn("flex h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      {segments
        .filter((s) => s.value > 0)
        .map((s) => (
          <div
            key={s.label}
            data-segment
            className={s.className}
            style={{ width: `${percentOf(s.value, total)}%` }}
          />
        ))}
    </div>
  );
}

export function SegmentLegend({
  segments,
  total,
  className,
}: {
  segments: BarSegment[];
  total: number;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {segments.map((s) => (
        <li key={s.label} className="flex items-center gap-2 text-xs">
          <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", s.dotClassName)} />
          <span className="font-medium text-foreground">{s.label}</span>
          <span className="text-muted-foreground">
            {s.value} ({percentOf(s.value, total)}%)
          </span>
        </li>
      ))}
    </ul>
  );
}

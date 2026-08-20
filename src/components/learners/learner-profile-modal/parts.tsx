import { cn } from "@/lib/utils";
import { parseLocalDateKey } from "@/lib/date-keys";

/**
 * Shared read-only building blocks for the Student Profile modal.
 *
 * The comp draws three kinds of value: a labelled field inside a card, an
 * icon-led row in the left rail, and a tinted status pill. Each gets one
 * component here so the five tab panels stay declarative.
 */

/** `YYYY-MM-DD` → readable date. Null renders the em dash the comp uses. */
export function formatDateKey(key: string | null | undefined): string {
  if (!key) return "—";
  return parseLocalDateKey(key).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Blank-safe value — an empty string reads as a bug, an em dash reads as "none". */
export function orDash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "—";
}

/**
 * Enum key → label. The action serialises enums to `string`, so the `as const`
 * label maps can't be indexed directly; an unknown key falls back to itself
 * rather than rendering blank.
 */
export function labelOf(
  map: Readonly<Record<string, string>>,
  key: string | null | undefined,
  fallback = "—"
): string {
  if (!key) return fallback;
  return map[key] ?? key;
}

/** Enum keys → comma-joined labels, or an em dash when the list is empty. */
export function labelList(
  map: Readonly<Record<string, string>>,
  keys: string[] | null | undefined
): string {
  if (!keys || keys.length === 0) return "—";
  return keys.map((k) => map[k] ?? k).join(", ");
}

/** Card wrapper matching the comp's three stacked panels. */
export function InfoCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border/80 bg-card shadow-sm",
        className
      )}
    >
      <h3 className="border-b border-border/60 px-4 py-3 text-sm font-semibold text-foreground">
        {title}
      </h3>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** Two-column grid the comp uses inside every card. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>;
}

/** Label above value, the comp's field treatment. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}

/** Icon-led row in the left rail. */
export function RailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="block break-words font-medium text-foreground">
          {children}
        </span>
      </span>
    </div>
  );
}

const PILL_BASE =
  "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold";

const PILL_TONE = {
  /** The comp's green "Active" / "Enrolled" state. */
  positive:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  neutral: "bg-muted text-muted-foreground",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  /** ARAL keeps the reserved violet. */
  aral: "bg-violet-soft text-violet-soft-foreground",
} as const;

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof PILL_TONE;
  children: React.ReactNode;
}) {
  return <span className={cn(PILL_BASE, PILL_TONE[tone])}>{children}</span>;
}

/** Section heading inside a tab body — used by the ARAL panel's C/D/E blocks. */
export function BlockHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-3 text-sm font-semibold text-foreground">{children}</h4>
  );
}

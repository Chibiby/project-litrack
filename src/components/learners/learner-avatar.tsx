import { cn } from "@/lib/utils";

/**
 * The comp shows a photo beside every learner's name. `Learner` has no photo
 * column and none is planned, so the slot keeps its size and rhythm but carries
 * the learner's initials instead — inventing stock faces for real children
 * would be worse than an honest monogram.
 *
 * The tint is derived from the learner id, so a given learner keeps the same
 * colour on every visit and the column reads as varied rather than striped.
 */
const TONES = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
  "bg-aral-100 text-aral-strong dark:bg-aral-900/40",
  "bg-success-100 text-success-strong dark:bg-success-900/30",
  "bg-warning-100 text-warning-strong dark:bg-warning-900/30",
  "bg-danger-100 text-danger-strong dark:bg-danger-900/30",
] as const;

/** Stable non-negative hash — same id always lands on the same tone. */
function toneFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TONES[Math.abs(hash) % TONES.length];
}

/**
 * First and last initial. Names in this roster arrive in mixed shapes — some
 * all-caps, some with middle initials already inside `fullName` — so take the
 * first and last word rather than assuming a fixed number of parts.
 */
export function learnerInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

export function LearnerAvatar({
  id,
  fullName,
  className,
}: {
  id: string;
  fullName: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 select-none items-center justify-center rounded-full text-xs font-semibold",
        toneFor(id),
        className
      )}
    >
      {learnerInitials(fullName)}
    </span>
  );
}

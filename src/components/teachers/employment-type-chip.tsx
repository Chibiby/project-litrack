import { Badge } from "@/components/ui/badge";
import { EMPLOYMENT_TYPE_LABELS } from "@/lib/constants/enum-labels";

/**
 * Whether a teacher holds a DepEd plantilla item, shown beside their name
 * wherever an ARAL tutor is chosen.
 *
 * DISPLAY ONLY. It answers "who am I picking?", never "who may I pick?" — a
 * non-DepEd teacher is a valid ARAL tutor, which is the whole reason the field
 * exists. Nothing here filters, disables or reorders a list.
 *
 * `null` renders nothing rather than an "Unknown" chip: most profiles predate
 * the question, and a roster of grey "Unknown" chips says less than a roster
 * where the chip only appears when it carries an answer.
 */
export function EmploymentTypeChip({
  employmentType,
  className,
}: {
  employmentType: "DEPED_PLANTILLA" | "NON_DEPED" | null;
  className?: string;
}) {
  if (!employmentType) return null;

  return (
    <Badge
      variant="outline"
      className={`px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${className ?? ""}`}
    >
      {EMPLOYMENT_TYPE_LABELS[employmentType]}
    </Badge>
  );
}

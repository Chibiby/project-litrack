"use client";

import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The advisory picker the Learners and End of Terms pages share: one
 * highlighted dropdown, All advisories first, then each section the teacher
 * advises. It is the page's scope, so it is tinted to stand apart from the
 * plain filters beside it.
 */
export function AdvisorySelect({
  advisories,
  value,
  onChange,
  showAllOption = true,
  className,
}: {
  advisories: readonly { id: string; label: string }[];
  /** A section id, or null for All advisories. */
  value: string | null;
  onChange: (advisory: string | null) => void;
  /**
   * Hide the "All advisories" item and require a specific advisory. Owner
   * decision: a teacher whose advisories mix Kindergarten with other grades
   * has no view spanning both report shapes, so the End of Terms hero passes
   * `false` for that teacher only. Defaults to `true`, so the Learners page
   * and every other existing caller is unchanged.
   */
  showAllOption?: boolean;
  className?: string;
}) {
  const none = advisories.length === 0;
  return (
    <Select
      value={value ?? (showAllOption ? "all" : "")}
      onValueChange={(v) => onChange(v === "all" ? null : v)}
      disabled={none}
    >
      <SelectTrigger
        aria-label="Advisory"
        className={cn(
          "h-11 gap-2 rounded-md border-aral-300 bg-aral-50 font-semibold text-aral-800 shadow-sm hover:bg-aral-100 focus:ring-aral-400 dark:border-aral-800 dark:bg-aral-950/40 dark:text-aral-200 dark:hover:bg-aral-950/60 [&>svg]:text-aral-600 dark:[&>svg]:text-aral-300",
          className
        )}
      >
        <Users className="size-4 shrink-0 text-aral-600 dark:text-aral-300" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {showAllOption ? (
          <SelectItem value="all">{none ? "No advisory" : "All advisories"}</SelectItem>
        ) : null}
        {advisories.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

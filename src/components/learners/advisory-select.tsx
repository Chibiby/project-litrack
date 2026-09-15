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
  className,
}: {
  advisories: readonly { id: string; label: string }[];
  /** A section id, or null for All advisories. */
  value: string | null;
  onChange: (advisory: string | null) => void;
  className?: string;
}) {
  const none = advisories.length === 0;
  return (
    <Select
      value={value ?? "all"}
      onValueChange={(v) => onChange(v === "all" ? null : v)}
      disabled={none}
    >
      <SelectTrigger
        aria-label="Advisory"
        className={cn(
          "h-11 gap-2 rounded-xl border-violet-300 bg-violet-50 font-semibold text-violet-800 shadow-sm hover:bg-violet-100 focus:ring-violet-400 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200 dark:hover:bg-violet-950/60 [&>svg]:text-violet-600 dark:[&>svg]:text-violet-300",
          className
        )}
      >
        <Users className="size-4 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{none ? "No advisory" : "All advisories"}</SelectItem>
        {advisories.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

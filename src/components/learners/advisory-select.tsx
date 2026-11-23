"use client";

import { Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * The solid purple trigger every page-scope dropdown shares (advisory, ARAL
 * grade): the one filled control in a toolbar, so the scope reads first.
 * Theme tokens, so dark mode gets the lighter purple with dark text.
 */
export const ARAL_SCOPE_TRIGGER =
  "h-11 gap-2 rounded-md border-aral bg-aral font-semibold text-aral-foreground shadow-sm hover:bg-aral/90 focus:ring-aral data-[placeholder]:text-aral-foreground [&>svg]:text-aral-foreground [&>svg]:opacity-100";

/**
 * Advisories grouped under their grade, in the order they arrive. The grade is
 * the part of the label before the first " - " or " · " (labels are built as
 * `${gradeLabel} - ${sectionName}` or `${gradeLabel} · ${sectionName}`, and no
 * grade label contains either). A label with neither gets no heading
 * (`grade` is null): it would only repeat the item below it.
 */
export function groupAdvisoriesByGrade<T extends { label: string }>(
  advisories: readonly T[]
): { grade: string | null; items: T[] }[] {
  const groups: { grade: string | null; items: T[] }[] = [];
  for (const a of advisories) {
    const cut = a.label.search(/ [-·] /);
    const grade = cut > 0 ? a.label.slice(0, cut) : null;
    const group = groups.find((g) => g.grade === grade);
    if (group) group.items.push(a);
    else groups.push({ grade, items: [a] });
  }
  return groups;
}

/**
 * The dropdown body every advisory picker shares: a grade heading, then that
 * grade's sections, each read in full ("Kinder - A"). No "All of Kinder" row:
 * the page's scope is an advisory or all of them.
 */
export function AdvisoryGroupedItems({
  advisories,
}: {
  advisories: readonly { id: string; label: string }[];
}) {
  return (
    <>
      {groupAdvisoriesByGrade(advisories).map((group) => (
        <SelectGroup key={group.grade ?? `ungrouped-${group.items[0]?.id}`}>
          {group.grade ? <SelectLabel>{group.grade}</SelectLabel> : null}
          {group.items.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.label}
            </SelectItem>
          ))}
        </SelectGroup>
      ))}
    </>
  );
}

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
          ARAL_SCOPE_TRIGGER,
          className
        )}
      >
        <Users className="size-4 shrink-0 text-aral-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {showAllOption ? (
          <SelectItem value="all">{none ? "No advisory" : "All advisories"}</SelectItem>
        ) : null}
        <AdvisoryGroupedItems advisories={advisories} />
      </SelectContent>
    </Select>
  );
}

"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { kinderChecklistHref } from "@/components/terms/kinder-route";

/**
 * The Kindergarten advisory switcher. Used in two places:
 *
 *  - the checklist hero's top-right corner, once an advisory is resolved
 *    (`value` is the current section id) — same placement the numeric End of
 *    Terms page uses for `TermsAdvisoryHeroControl`.
 *  - the "choose a Kindergarten advisory" state (spec section 4's
 *    "unspecified" outcome), where `value` is `null` and nothing has been
 *    picked yet.
 *
 * Never falls back to the first option — picking is always an explicit act,
 * matching `resolveAdvisoryTarget`'s "ask, never guess" rule.
 */
export function KinderAdvisoryHeroControl({
  schoolId,
  advisories,
  value,
  className,
}: {
  schoolId: string;
  advisories: readonly { id: string; label: string }[];
  /** The resolved advisory's section id, or `null` while unspecified. */
  value: string | null;
  className?: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={value ?? ""}
      onValueChange={(advisory) =>
        router.push(kinderChecklistHref({ schoolId, advisory }), { scroll: false })
      }
    >
      <SelectTrigger aria-label="Kindergarten advisory" className={className}>
        <SelectValue placeholder="Choose a section" />
      </SelectTrigger>
      <SelectContent>
        {advisories.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

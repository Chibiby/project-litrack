"use client";

import { useRouter } from "next/navigation";
import { AdvisorySelect } from "@/components/learners/advisory-select";
import { sheetHref, type SheetUrlState } from "@/lib/terms/sheet-view";

/**
 * The End of Terms advisory switcher, floated in the page hero's top-right
 * corner. Sized down on phones so it never overlaps the title; `PageHero`
 * supplies the tinted surface behind it. Picking an advisory clears Section,
 * which lists the new scope's sections.
 *
 * `kinderSectionIds`/`kinderBasePath` let a mixed-advisory teacher pick a
 * Kindergarten section from this same dropdown: owner decision overrides the
 * spec's "All advisories" default for a Kinder+numeric mix — there is no
 * combined grid, so picking a Kinder section navigates away to its own route
 * instead of narrowing this sheet. Both optional and unused by any other
 * caller of this control.
 *
 * A non-empty `kinderSectionIds` also means this teacher's advisories mix
 * Kindergarten with other grades, so the dropdown drops "All advisories" too
 * (owner decision) — `page.tsx` defaults such a teacher's scope to their
 * non-Kinder advisory instead, via `resolveAdvisoryTarget`.
 */
export function TermsAdvisoryHeroControl({
  basePath,
  state,
  advisories,
  kinderSectionIds,
  kinderBasePath,
}: {
  basePath: string;
  state: SheetUrlState;
  advisories: readonly { id: string; label: string }[];
  kinderSectionIds?: readonly string[];
  kinderBasePath?: string;
}) {
  const router = useRouter();
  const kinderSet = kinderSectionIds ? new Set(kinderSectionIds) : null;
  const isMixed = Boolean(kinderSectionIds && kinderSectionIds.length > 0);
  return (
    <AdvisorySelect
      advisories={advisories}
      value={state.advisory}
      onChange={(advisory) => {
        if (advisory && kinderSet?.has(advisory) && kinderBasePath) {
          const sp = new URLSearchParams();
          if (state.schoolId) sp.set("schoolId", state.schoolId);
          sp.set("advisory", advisory);
          router.push(`${kinderBasePath}?${sp.toString()}`, { scroll: false });
          return;
        }
        router.push(sheetHref(basePath, { ...state, advisory, section: "all" }), {
          scroll: false,
        });
      }}
      showAllOption={!isMixed}
      className="h-9 w-32 text-xs sm:h-10 sm:w-44 sm:text-sm lg:h-11 lg:w-56"
    />
  );
}

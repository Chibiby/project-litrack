"use client";

import { useRouter } from "next/navigation";
import { AdvisorySelect } from "@/components/learners/advisory-select";
import {
  rosterHref,
  withAdvisory,
  type AdvisoryOption,
  type RosterUrlState,
} from "@/components/learners/learner-list-toolbar";

/**
 * The Learners roster's advisory switcher, floated in the page hero's
 * top-right corner. Sized down on phones so it never overlaps the title;
 * `PageHero` supplies the tinted surface behind it.
 */
export function AdvisoryHeroControl({
  basePath,
  state,
  advisories,
}: {
  basePath: string;
  state: RosterUrlState;
  advisories: readonly AdvisoryOption[];
}) {
  const router = useRouter();
  return (
    <AdvisorySelect
      advisories={advisories}
      value={state.advisory}
      onChange={(advisory) =>
        router.push(rosterHref(basePath, withAdvisory(state, advisory, advisories)))
      }
      className="h-11 w-36 gap-1.5 px-2 text-xs max-sm:[&_svg:first-child]:hidden sm:w-44 sm:gap-2 sm:px-3 sm:text-sm lg:w-56"
    />
  );
}

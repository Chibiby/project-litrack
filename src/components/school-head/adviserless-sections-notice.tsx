import Link from "next/link";
import { Callout } from "@/components/ui/callout";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import type { AdviserlessSection } from "@/lib/teachers/adviserless";

/**
 * Reminds the School Head that a section has live learners but no adviser —
 * the state a teacher's designation or advisory-mode change can create when
 * it releases a section.
 *
 * Renders nothing for an empty list. The "Assign advisers" link is omitted on
 * the Teachers page itself, where the School Head is already there.
 */
export function AdviserlessSectionsNotice({
  sections,
  showLink = true,
}: {
  sections: AdviserlessSection[];
  showLink?: boolean;
}) {
  if (sections.length === 0) return null;

  return (
    <Callout
      variant="warning"
      title={`${sections.length} section(s) have learners but no adviser`}
    >
      <ul className="list-disc space-y-0.5 pl-4">
        {sections.map((s) => (
          <li key={s.id}>
            {s.gradeLabel} · {s.sectionName} — {s.learnerCount} learner
            {s.learnerCount === 1 ? "" : "s"}
          </li>
        ))}
      </ul>
      {showLink ? (
        <Link
          href={SCHOOL_HEAD_ROUTES.teachers}
          className="mt-2 inline-block font-medium underline"
        >
          Assign advisers
        </Link>
      ) : null}
    </Callout>
  );
}

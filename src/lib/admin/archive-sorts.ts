import { defineSort } from "@/lib/sort/registry";

/**
 * The "Sort by" option lists for the two buckets on `/admin/archive`.
 *
 * These live in their own module, apart from `src/lib/admin/archive.ts`,
 * because the archive view (`src/components/admin/archive-view.tsx`) is a
 * client component and needs the option list at runtime to render the
 * dropdown. `archive.ts` is `server-only` and imports Prisma, so importing
 * the registries from there drags `@prisma/client` and `pg` into the client
 * bundle and the build fails with a module-not-found on `node:events`.
 *
 * Splitting the pure vocabulary out — rather than hand-copying the options
 * into the component — means the server's `orderBy` mapper and the dropdown
 * the user sees are built from one array. A copy would be free to drift into
 * offering a sort the query cannot serve.
 *
 * Nothing here may import Prisma, `server-only`, or anything that does.
 */

/**
 * Recently deleted is the default: this is a log-style list where recency is
 * the meaningful order, matching the `deletedAt: "desc"` the page originally
 * hardcoded.
 */
export const ARCHIVE_TEACHER_SORTS = defineSort(
  [
    { value: "recent", label: "Recently deleted" },
    { value: "alphabetical", label: "Alphabetical" },
    { value: "school", label: "School" },
  ] as const,
  "recent"
);

export type ArchiveTeacherSort =
  (typeof ARCHIVE_TEACHER_SORTS.options)[number]["value"];

/** Same options and default as the teacher bucket; the two sort independently. */
export const ARCHIVE_LEARNER_SORTS = defineSort(
  [
    { value: "recent", label: "Recently deleted" },
    { value: "alphabetical", label: "Alphabetical" },
    { value: "school", label: "School" },
  ] as const,
  "recent"
);

export type ArchiveLearnerSort =
  (typeof ARCHIVE_LEARNER_SORTS.options)[number]["value"];

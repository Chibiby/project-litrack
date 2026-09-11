import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import * as tags from "@/lib/cache/tags";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * The School Head teachers workspace — all five tab pathnames — plus this
 * school's teacher list wherever it is cached.
 *
 * `revalidatePath(p)` with no `type` emits one softTag that matches only a
 * render whose concrete URL is exactly `p`, which is why there are five calls
 * for five pathnames rather than one for the folder. All five of those pages are
 * `force-dynamic`, so none of them has a Full Route Cache entry for those
 * softTags to hit. They are not free of the Data Cache, though: all four call
 * `resolveSchoolHeadView`, which on a Super Admin drill-down (`?schoolId=`)
 * awaits `getSchoolName` (`src/lib/cache/school.ts`) — a `cachedQuery` read — so
 * that path does create a `school-name:<id>` entry. Do not rely on these
 * `revalidatePath` calls to clear it; the tag `schoolName(schoolId)` is its named
 * bust, and `revalidateSchoolDashboard` is what emits that. The tab badges are
 * fresh because the pages re-query per request, and the client Router Cache is
 * cleared wholesale by any server action regardless of this call.
 *
 * What does work now is the tag: `schoolTeachers(schoolId)` busts the Data
 * Cache entries holding this school's teacher list — `listAralTutors`, read by
 * the ARAL tutor pickers on `/teacher/aral`, the two ARAL grade sheets,
 * `/school-head/aral`, and the `listAralTutorOptions` action. Those readers are
 * `force-dynamic` too, so they have a Data Cache entry and still no Full Route
 * Cache entry — two different caches, and only the first one is invalidated
 * here. Rendered HTML is never cached on a role page.
 *
 * Takes a `schoolId` because that tag is tenant-scoped. Pass the same
 * `schoolId` the calling action scoped its own ownership check to.
 */
export function revalidateSchoolHeadTeachers(schoolId: string) {
  revalidatePath(SCHOOL_HEAD_ROUTES.teachers);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersPending);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersInactive);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersDeclined);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersRemoved);
  revalidateSchoolTeachers(schoolId);
}

/** One school's cached teacher list (ARAL tutor pickers). */
export function revalidateSchoolTeachers(schoolId: string) {
  revalidateTag(tags.schoolTeachers(schoolId));
}

/** Admin system-wide dashboard aggregates. */
export function revalidateAdminDashboard() {
  revalidateTag(tags.adminDashboard);
}

/** Admin schools list (and related admin dashboard school snippets). */
export function revalidateSchoolsList() {
  revalidateTag(tags.schoolsList);
  revalidateTag(tags.adminDashboard);
}

/** School-scoped dashboard + school name. */
export function revalidateSchoolDashboard(schoolId: string) {
  revalidateTag(tags.schoolDashboard(schoolId));
  revalidateTag(tags.schoolName(schoolId));
}

/** Teacher dashboard metrics only (not sidebar shell). */
export function revalidateTeacherDashboard(userId: string) {
  revalidateTag(tags.teacherDashboard(userId));
}

/** Teacher sidebar shell (grade links + hasAral). */
export function revalidateTeacherShell(userId: string) {
  revalidateTag(tags.teacherShell(userId));
}

/**
 * Dashboard + shell — use when grade assignments or ARAL sidebar presence change.
 */
export function revalidateTeacherCaches(userId: string) {
  revalidateTeacherDashboard(userId);
  revalidateTeacherShell(userId);
}

/**
 * Learner / ARAL / attendance / reading mutations that affect school-head
 * and (optionally) teacher dashboards.
 *
 * - Does **not** bust `adminDashboard` unless `adminDashboard: true`
 *   (create / archive / import that change global learner counts).
 * - Does **not** bust `teacherShell` unless `teacherShell: true`
 *   (ARAL presence or grade assignment changes).
 */
export function revalidateLearnerScoped(opts: {
  schoolId: string;
  teacherId?: string | null;
  /**
   * Designated ARAL teacher, when the learner has one. Their dashboard/sidebar
   * is derived from the learners they track, so it must be busted alongside the
   * adviser's — an ARAL-only teacher has no other path into these caches.
   */
  aralTeacherId?: string | null;
  /** Bust teacher sidebar when ARAL presence may change. */
  teacherShell?: boolean;
  /** Bust admin system-wide learner metrics. */
  adminDashboard?: boolean;
}) {
  revalidateSchoolDashboard(opts.schoolId);
  if (opts.adminDashboard) {
    revalidateTag(tags.adminDashboard);
  }
  const teacherIds = new Set(
    [opts.teacherId, opts.aralTeacherId].filter(
      (id): id is string => typeof id === "string" && id.length > 0
    )
  );
  for (const teacherId of teacherIds) {
    revalidateTeacherDashboard(teacherId);
    if (opts.teacherShell) {
      revalidateTeacherShell(teacherId);
    }
  }
}

/**
 * A support ticket changed state.
 *
 * Busts the admin inbox and the requester's own list. Takes the requester id
 * rather than deriving it, because a resolve is performed by the admin and the
 * list that goes stale belongs to somebody else.
 */
export function revalidateSupportTicket(requesterId: string) {
  revalidateTag(tags.supportInbox);
  revalidateTag(tags.userSupportTickets(requesterId));
}

/**
 * An unlock grant was issued or revoked.
 *
 * Two surfaces go stale and they belong to different people, which is why this
 * takes a list rather than deriving one:
 *
 * 1. **Each recipient's own support panel.** The assistant lists a person's
 *    tickets with the expiry of the grant each produced, so the grant holder —
 *    not the admin who issued it — is whose cached list is now wrong. A
 *    school-wide grant has N of them.
 * 2. **The admin console** at `/admin/settings/submissions`, which renders the
 *    live-grant tables and the admin's own view of what they just did.
 *
 * Nothing else needs busting, and in particular **the teacher-facing lock
 * surfaces do not**. Every role page is `force-dynamic`, and `canWriteWindow` /
 * `readUnlockState` (`src/lib/unlock/grants.ts`) are React-`cache()`d per
 * request only — never `unstable_cache` — so the very next request re-reads the
 * grant row. There is no tag to emit for them, and adding one would suggest a
 * Data Cache entry exists where none does.
 */
export function revalidateUnlockGrants({ recipientIds }: { recipientIds: string[] }) {
  for (const recipientId of recipientIds) {
    revalidateSupportTicket(recipientId);
  }
  revalidatePath("/admin/settings/submissions");
}

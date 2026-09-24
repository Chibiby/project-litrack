import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import type { UserRole } from "@prisma/client";
import * as tags from "@/lib/cache/tags";
import { roleSettingsProfilePath } from "@/lib/auth/roles";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * Expire every Data Cache entry carrying `tag` immediately: the next read is a
 * blocking miss, never a stale hit.
 *
 * Next 16 made `revalidateTag`'s second argument mandatory. `"max"` (the docs'
 * recommendation) is stale-while-revalidate — a user who just saved would be
 * served the pre-save dashboard once more — which would be a behavior change
 * from Next 15's single-argument call. `{ expire: 0 }` is documented as
 * identical to that old call, and unlike `updateTag` it also works outside a
 * Server Action (these helpers are reached from non-action code too). On
 * Cloudflare the D1 tag cache stores it as `stale = expire = now`, which
 * `hasBeenRevalidated` treats as a miss and `isStale` does not.
 */
function expireTag(tag: string) {
  revalidateTag(tag, { expire: 0 });
}

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
 *
 * Also busts `schoolDashboard(schoolId)` (via `revalidateSchoolDashboard`):
 * approving, rejecting, removing, or (de)activating a teacher changes the
 * dashboard's pending-approval and teacher counts, both read out of
 * `getSchoolHeadMetricCounts`, which is cached under that same tag. Without
 * this a head who just approved every pending teacher would see "N waiting"
 * for up to the cache's TTL — the one figure whose entire job is to prompt an
 * action. Nearly every call site already paired an explicit
 * `revalidateSchoolDashboard(schoolId)` next to this call for exactly that
 * reason; this fold makes the pairing the default instead of something every
 * new call site has to remember.
 */
export function revalidateSchoolHeadTeachers(schoolId: string) {
  revalidatePath(SCHOOL_HEAD_ROUTES.teachers);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersPending);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersInactive);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersDeclined);
  revalidatePath(SCHOOL_HEAD_ROUTES.teachersRemoved);
  revalidateSchoolTeachers(schoolId);
  revalidateSchoolDashboard(schoolId);
}

/** One school's cached teacher list (ARAL tutor pickers). */
export function revalidateSchoolTeachers(schoolId: string) {
  expireTag(tags.schoolTeachers(schoolId));
}

/**
 * Every teacher End of Terms sheet. A subject edit changes the columns of one
 * grade's sheet, but the route is keyed by grade id in the URL and the page is
 * `force-dynamic`, so busting the dynamic segment as a whole is the honest call.
 */
export function revalidateTermSheets() {
  revalidatePath("/teacher/aral/[gradeId]/terms-reports", "page");
}

/** The School Head subject management page, plus every sheet it feeds. */
export function revalidateTermSubjects() {
  revalidatePath(SCHOOL_HEAD_ROUTES.termSubjects);
  revalidateTermSheets();
}

/**
 * The Super Admin per-`GradeLevelType` default-subject console.
 *
 * Deliberately does NOT bust `revalidateTermSubjects`/`revalidateTermSheets`:
 * editing a template affects only grades seeded or reset afterwards, never an
 * already-seeded school's live `TermSubject` rows, so no school-facing page
 * goes stale here.
 */
export function revalidateTermSubjectDefaults() {
  revalidatePath("/admin/term-subjects");
}

/**
 * Every Data Cache entry, in every school. For a database restore, undo, or
 * reset, which rewrite rows no per-tenant tag describes; without this the
 * dashboards and lists would show pre-restore numbers until their TTLs lapse
 * (up to 15 minutes for a school name).
 */
export function revalidateAllCachedData() {
  expireTag(tags.allCachedData);
}

/** Admin system-wide dashboard aggregates. */
export function revalidateAdminDashboard() {
  expireTag(tags.adminDashboard);
}

/**
 * Admin schools list (and related admin dashboard school snippets).
 *
 * Also expires the division summary: a school created, archived, re-districted,
 * or flagged demo changes which schools every summary scope covers.
 */
export function revalidateSchoolsList() {
  expireTag(tags.schoolsList);
  expireTag(tags.adminDashboard);
  expireTag(tags.divisionSummary);
}

/** Every cached summary facet at every scope (division and district). */
export function revalidateDivisionSummary() {
  expireTag(tags.divisionSummary);
}

/** School-scoped dashboard + school name. */
export function revalidateSchoolDashboard(schoolId: string) {
  expireTag(tags.schoolDashboard(schoolId));
  expireTag(tags.schoolName(schoolId));
}

/** Teacher dashboard metrics only (not sidebar shell). */
export function revalidateTeacherDashboard(userId: string) {
  expireTag(tags.teacherDashboard(userId));
}

/** Teacher sidebar shell (grade links + hasAral). */
export function revalidateTeacherShell(userId: string) {
  expireTag(tags.teacherShell(userId));
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
    expireTag(tags.adminDashboard);
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
  expireTag(tags.supportInbox);
  expireTag(tags.userSupportTickets(requesterId));
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
/**
 * One user's profile photo was set or removed.
 *
 * Deliberately a short list, because `avatarPath` is never read inside
 * `cachedQuery` — there is no Data Cache entry holding a photo and therefore no
 * tag to expire. What these calls clear is the Router Cache on the surfaces
 * that render the photo from a server read:
 *
 * 1. **The owner's own Settings → Profile page**, which is where the change was
 *    made and the one page that must never show the old picture back.
 * 2. **`/admin/accounts`**, the Super Admin accounts table and its account
 *    profile dialog. Busted for every role, because that one table lists all
 *    three and the admin who just moderated a photo is standing on it.
 * 3. **The School Head teachers workspace**, but only for a TEACHER who still
 *    has a school — that is the only list outside `/admin` that shows someone
 *    else's photo. `revalidateSchoolHeadTeachers` is tenant-scoped, so it takes
 *    the TARGET's `schoolId`, never the actor's: a Super Admin moderating a
 *    teacher must clear that teacher's school, not the admin's (which is null).
 *
 * The shell avatar (header, sidebar, account menu) needs nothing here: every
 * role layout is `force-dynamic` and reads `avatarPath` off `getCurrentUser`,
 * so the next request already has it. The client also calls `router.refresh()`.
 */
export function revalidateUserAvatar({
  role,
  schoolId,
}: {
  role: UserRole;
  schoolId: string | null;
}) {
  revalidatePath(roleSettingsProfilePath(role));
  revalidatePath("/admin/accounts");
  if (role === "TEACHER" && schoolId) {
    revalidateSchoolHeadTeachers(schoolId);
  }
}

export function revalidateUnlockGrants({ recipientIds }: { recipientIds: string[] }) {
  for (const recipientId of recipientIds) {
    revalidateSupportTicket(recipientId);
  }
    revalidatePath("/admin/submissions");
    revalidatePath("/admin/settings/submissions");
}

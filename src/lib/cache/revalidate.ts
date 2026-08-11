import "server-only";
import { revalidateTag } from "next/cache";
import * as tags from "@/lib/cache/tags";

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
  /** Bust teacher sidebar when ARAL presence may change. */
  teacherShell?: boolean;
  /** Bust admin system-wide learner metrics. */
  adminDashboard?: boolean;
}) {
  revalidateSchoolDashboard(opts.schoolId);
  if (opts.adminDashboard) {
    revalidateTag(tags.adminDashboard);
  }
  if (opts.teacherId) {
    revalidateTeacherDashboard(opts.teacherId);
    if (opts.teacherShell) {
      revalidateTeacherShell(opts.teacherId);
    }
  }
}

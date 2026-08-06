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

/** Teacher dashboard + sidebar shell for a user. */
export function revalidateTeacherDashboard(userId: string) {
  revalidateTag(tags.teacherDashboard(userId));
  revalidateTag(tags.teacherShell(userId));
}

/**
 * Learner / ARAL / attendance / reading mutations that affect both
 * school-head and teacher dashboards.
 */
export function revalidateLearnerScoped(opts: {
  schoolId: string;
  teacherId?: string | null;
}) {
  revalidateSchoolDashboard(opts.schoolId);
  revalidateTag(tags.adminDashboard);
  if (opts.teacherId) {
    revalidateTeacherDashboard(opts.teacherId);
  }
}

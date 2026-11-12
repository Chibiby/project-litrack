import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { divisionSchoolYear, schoolDashboard } from "@/lib/cache/tags";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { AppError } from "@/lib/errors/app-error";
import { evaluateWindow, dateKeyUtc, type ClosedReason } from "@/lib/school-year/window";

/**
 * Is this school's year open for changes?
 *
 * Open means: the school has an active SchoolYear, the Division Admin has set
 * an active duration for its label, and today (school time) is inside it.
 * Outside that, learners, ARAL, MOSY, BOSY and every other school record are
 * read-only for everyone, and the header shows "No active school year".
 */
export type SchoolYearGate = {
  open: boolean;
  reason: ClosedReason | null;
  isLastMonth: boolean;
  schoolYearId: string | null;
  label: string | null;
  /** `YYYY-MM-DD`, the Division Admin's duration. */
  activeStart: string | null;
  activeEnd: string | null;
};

const CLOSED_NO_YEAR: SchoolYearGate = {
  open: false,
  reason: "NO_ACTIVE_YEAR",
  isLastMonth: false,
  schoolYearId: null,
  label: null,
  activeStart: null,
  activeEnd: null,
};

/** All division windows, small (one row per label), cached. */
function divisionWindows() {
  return cachedQuery(
    async () => {
      const rows = await prisma.divisionSchoolYear.findMany({
        select: { label: true, activeStart: true, activeEnd: true },
      });
      // Dates survive the cache as strings; rebuild them on read.
      return rows.map((r) => ({
        label: r.label,
        activeStart: dateKeyUtc(r.activeStart),
        activeEnd: dateKeyUtc(r.activeEnd),
      }));
    },
    { keyParts: ["division-school-year-windows"], tags: [divisionSchoolYear], profile: "volatile" }
  );
}

function toWindow(w: { activeStart: string; activeEnd: string } | undefined) {
  return w
    ? { activeStart: new Date(`${w.activeStart}T00:00:00Z`), activeEnd: new Date(`${w.activeEnd}T00:00:00Z`) }
    : null;
}

function activeYearFor(schoolId: string) {
  return cachedQuery(
    () =>
      prisma.schoolYear.findFirst({
        where: { schoolId, isActive: true },
        select: { id: true, label: true },
      }),
    { keyParts: ["school-active-year-label", schoolId], tags: [schoolDashboard(schoolId), divisionSchoolYear], profile: "volatile" }
  );
}

/** Per request: the gate for one school. */
export const getSchoolYearGate = cache(async (schoolId: string): Promise<SchoolYearGate> => {
  const [year, windows] = await Promise.all([activeYearFor(schoolId), divisionWindows()]);
  if (!year) return CLOSED_NO_YEAR;
  const w = windows.find((x) => x.label === year.label);
  const state = evaluateWindow(toWindow(w), formatLocalDateKey(schoolToday()));
  return {
    ...state,
    schoolYearId: year.id,
    label: year.label,
    activeStart: w?.activeStart ?? null,
    activeEnd: w?.activeEnd ?? null,
  };
});

/**
 * Per request: the division-wide view for accounts without a school (Division
 * and District Admins) — open when any label's duration contains today.
 */
export const getDivisionGate = cache(async (): Promise<SchoolYearGate> => {
  const windows = await divisionWindows();
  const todayKey = formatLocalDateKey(schoolToday());
  for (const w of [...windows].sort((a, b) => b.activeStart.localeCompare(a.activeStart))) {
    const state = evaluateWindow(toWindow(w), todayKey);
    if (state.open) {
      return { ...state, schoolYearId: null, label: w.label, activeStart: w.activeStart, activeEnd: w.activeEnd };
    }
  }
  return { ...CLOSED_NO_YEAR, reason: windows.length ? "ENDED" : "NO_WINDOW" };
});

/** The gate for whoever is signed in: their school's, or the division's. */
export function getGateForUser(user: { schoolId: string | null }): Promise<SchoolYearGate> {
  return user.schoolId ? getSchoolYearGate(user.schoolId) : getDivisionGate();
}

/**
 * Guard for every school-record write (learners, enrollment, ARAL, MOSY, BOSY,
 * attendance, reading levels, grades). Throws SCHOOL_YEAR_CLOSED, which the
 * `action()` wrapper returns as a normal failure result.
 */
export async function assertSchoolYearOpen(schoolId: string): Promise<SchoolYearGate> {
  const gate = await getSchoolYearGate(schoolId);
  if (!gate.open) {
    throw new AppError("SCHOOL_YEAR_CLOSED", { context: { reason: gate.reason, schoolId } });
  }
  return gate;
}

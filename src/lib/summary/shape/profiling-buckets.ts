import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Pure bucketing for the profiling facet (spec 4.7). Free-text answers are
 * never listed, only counted into a fixed bucket.
 */

export type YearsInServiceBucket = "Y0_3" | "Y4_10" | "Y11_20" | "Y21_PLUS" | "NA";

export const YEARS_IN_SERVICE_BUCKETS: readonly YearsInServiceBucket[] = [
  "Y0_3",
  "Y4_10",
  "Y11_20",
  "Y21_PLUS",
  "NA",
];

export const YEARS_IN_SERVICE_LABELS: Record<YearsInServiceBucket, string> = {
  Y0_3: "0–3 years",
  Y4_10: "4–10 years",
  Y11_20: "11–20 years",
  Y21_PLUS: "21 years and above",
  NA: "N/A",
};

/** The DOCX bands. Null (a teacher who chose N/A) is `NA`. */
export function bucketYearsInService(years: number | null | undefined): YearsInServiceBucket {
  if (years === null || years === undefined || !Number.isFinite(years) || years < 0) return "NA";
  if (years <= 3) return "Y0_3";
  if (years <= 10) return "Y4_10";
  if (years <= 20) return "Y11_20";
  return "Y21_PLUS";
}

export type DesignationBucket =
  | "TEACHER"
  | "MASTER_TEACHER"
  | "SCHOOL_HEAD"
  | "ARAL_VOLUNTEER"
  | "OTHERS"
  | "NOT_ANSWERED";

export const DESIGNATION_BUCKETS: readonly DesignationBucket[] = [
  "TEACHER",
  "MASTER_TEACHER",
  "SCHOOL_HEAD",
  "ARAL_VOLUNTEER",
  "OTHERS",
  "NOT_ANSWERED",
];

export const DESIGNATION_LABELS: Record<DesignationBucket, string> = {
  TEACHER: "Teacher",
  MASTER_TEACHER: "Master Teacher",
  SCHOOL_HEAD: "School Head",
  ARAL_VOLUNTEER: ARAL_VOLUNTEER_DESIGNATION,
  OTHERS: "Others",
  NOT_ANSWERED: "Not answered",
};

/**
 * The profiling form offers "Teacher", "Master Teacher", the volunteer
 * designation, and "Others" free text; School Heads always store "School Head".
 * Matching is case- and whitespace-insensitive so a legacy "teacher" still
 * lands in its bucket; any other text is "Others" and is not listed.
 */
export function bucketDesignation(designation: string | null | undefined): DesignationBucket {
  const folded = (designation ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (!folded) return "NOT_ANSWERED";
  if (folded === "teacher") return "TEACHER";
  if (folded === "master teacher") return "MASTER_TEACHER";
  if (folded === "school head") return "SCHOOL_HEAD";
  if (folded === ARAL_VOLUNTEER_DESIGNATION.toLowerCase()) return "ARAL_VOLUNTEER";
  return "OTHERS";
}

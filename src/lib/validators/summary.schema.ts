import { z } from "zod";
import { reportPurposeSchema } from "./report.schema";
import { SUMMARY_FACET_IDS, SUMMARY_LEVELS } from "@/lib/summary/types";

/**
 * Summary facet params and the export request (docs/specs/district-admin.md 3.6).
 *
 * Params arrive from search params as well as from the export payload, so an
 * empty string means "not given" everywhere here, exactly as `?district=` is
 * read by `resolveSummaryScope`. Defaults that depend on the date (this month,
 * July of this school year) are filled in by the facet, not here, so a
 * validated value never goes stale inside a cache entry.
 */

/** `""` and null read as "not given". */
function optional<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((v) => (v === "" || v === null ? undefined : v), schema.optional());
}

export const MAX_SUMMARY_MONTHS = 12;

const monthKey = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month");

export const summaryFacetIdSchema = z.enum(SUMMARY_FACET_IDS, {
  message: "Choose a summary",
});

export const summaryLevelSchema = z
  .preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.enum(SUMMARY_LEVELS, { message: "Choose overall, by district or by school" }).optional()
  )
  .transform((v) => v ?? "overall");

function monthsApart(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty! - fy!) * 12 + (tm! - fm!);
}

/** Facets with no params of their own: learners, compliance, profiling. */
export const levelOnlyParamsSchema = z.object({ level: summaryLevelSchema });

/** `reading-behavior`: one month, default July of the current school year. */
export const monthParamsSchema = z.object({
  level: summaryLevelSchema,
  month: optional(monthKey),
});

/** `attendance`, `reading-levels`: an inclusive month range, at most 12 months. */
export const monthRangeParamsSchema = z
  .object({
    level: summaryLevelSchema,
    from: optional(monthKey),
    to: optional(monthKey),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, {
    message: "The first month must be on or before the last month",
    path: ["from"],
  })
  .refine((d) => !d.from || !d.to || monthsApart(d.from, d.to) < MAX_SUMMARY_MONTHS, {
    message: `Choose at most ${MAX_SUMMARY_MONTHS} months`,
    path: ["to"],
  });

/** `end-of-term`: school-year label and term; defaults resolved from the data (Q15). */
export const endOfTermParamsSchema = z.object({
  level: summaryLevelSchema,
  schoolYearLabel: optional(
    z.string().trim().min(1).max(40, "Choose a school year")
  ),
  term: optional(z.enum(["FIRST", "SECOND", "THIRD"], { message: "Choose a term" })),
});

export type LevelOnlyParams = z.infer<typeof levelOnlyParamsSchema>;
export type MonthParams = z.infer<typeof monthParamsSchema>;
export type MonthRangeParams = z.infer<typeof monthRangeParamsSchema>;
export type EndOfTermParams = z.infer<typeof endOfTermParamsSchema>;

/**
 * One export request. The scope fields (`district`, `schoolId`) are only
 * shape-checked: whether the caller may see them is decided by
 * `resolveSummaryScope` / `loadSchoolInScope` in the action. Facet params are
 * validated a second time by the facet's own schema.
 */
export const summaryExportSchema = z.object({
  facet: summaryFacetIdSchema,
  format: z.enum(["EXCEL", "PDF"], { message: "Choose Excel or PDF" }),
  purpose: reportPurposeSchema,
  district: optional(z.string().max(200)),
  schoolId: optional(z.string().max(100)),
  level: summaryLevelSchema,
  month: optional(z.string()),
  from: optional(z.string()),
  to: optional(z.string()),
  schoolYearLabel: optional(z.string()),
  term: optional(z.string()),
});

export type SummaryExportInput = z.infer<typeof summaryExportSchema>;

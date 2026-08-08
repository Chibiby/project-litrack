/**
 * Pure CSV learner-import helpers (mapping, normalization, validation).
 * Commit choice: valid rows are committed; invalid rows are reported (not all-or-nothing).
 */

import {
  GOV_BENEFIT_LABELS,
  PARENT_EDUCATION_LABELS,
  READING_PROFILE_LABELS,
  FRUSTRATION_SUBTYPE_LABELS,
  GENDER_LABELS,
} from "@/lib/constants/enum-labels";
import {
  learnerImportRowSchema,
  type LearnerImportRow,
} from "@/lib/validators/learner-import.schema";
import {
  isPossibleDuplicate,
  learnerDuplicateKey,
  normalizePersonName,
} from "@/lib/learners/normalize";

/** Canonical CSV headers (Section A + optional section + isAralLearner). */
export const LEARNER_CSV_HEADERS = [
  "firstName",
  "middleName",
  "lastName",
  "age",
  "gender",
  "section",
  "englishReadingProfile",
  "englishFrustrationSubtypes",
  "filipinoReadingProfile",
  "filipinoFrustrationSubtypes",
  "governmentBenefits",
  "parentEducation",
  "isAralLearner",
] as const;

export type LearnerCsvHeader = (typeof LEARNER_CSV_HEADERS)[number];

/** Normalize CSV header aliases (e.g. "Section" → "section"). */
export function normalizeLearnerCsvHeader(header: string): string {
  const trimmed = header.trim();
  if (trimmed.toLowerCase() === "section") return "section";
  return trimmed;
}

export function learnerCsvTemplate(): string {
  const header = LEARNER_CSV_HEADERS.join(",");
  const example = [
    "Ana",
    "M",
    "Santos",
    "10",
    "FEMALE",
    "",
    "INSTRUCTIONAL_DEVELOPING",
    "",
    "INDEPENDENT_GRADE_READY",
    "",
    "FOUR_PS",
    "SECONDARY_GRADUATE",
    "false",
  ].join(",");
  return `${header}\n${example}\n`;
}

function buildLookup(labels: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [code, label] of Object.entries(labels)) {
    map.set(normalizeKey(code), code);
    map.set(normalizeKey(label), code);
  }
  return map;
}

function normalizeKey(s: string): string {
  return s.trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

const GENDER_LOOKUP = buildLookup(GENDER_LABELS as Record<string, string>);
const PROFILE_LOOKUP = buildLookup(READING_PROFILE_LABELS as Record<string, string>);
const FRUSTRATION_LOOKUP = buildLookup(
  FRUSTRATION_SUBTYPE_LABELS as Record<string, string>
);
const BENEFIT_LOOKUP = buildLookup(GOV_BENEFIT_LABELS as Record<string, string>);
const PARENT_ED_LOOKUP = buildLookup(PARENT_EDUCATION_LABELS as Record<string, string>);

export function parseDelimitedList(raw: unknown): string[] {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split(/[;|]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function resolveEnumValue(
  raw: unknown,
  lookup: Map<string, string>
): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return lookup.get(normalizeKey(s));
}

export function parseBooleanLoose(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw == null || raw === "") return false;
  const s = String(raw).trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(s)) return true;
  if (["false", "no", "n", "0", "off"].includes(s)) return false;
  return false;
}

/** Map a raw CSV object (header keys) into a candidate import payload. */
export function mapCsvRowToImportCandidate(
  row: Record<string, unknown>
): Record<string, unknown> {
  const firstName = String(row.firstName ?? "").trim();
  const lastName = String(row.lastName ?? "").trim();
  const middleRaw = String(row.middleName ?? "").trim();

  const englishFrustrationSubtypes = parseDelimitedList(row.englishFrustrationSubtypes)
    .map((v) => resolveEnumValue(v, FRUSTRATION_LOOKUP) ?? v)
    .filter(Boolean);

  const filipinoFrustrationSubtypes = parseDelimitedList(row.filipinoFrustrationSubtypes)
    .map((v) => resolveEnumValue(v, FRUSTRATION_LOOKUP) ?? v)
    .filter(Boolean);

  const governmentBenefits = parseDelimitedList(row.governmentBenefits)
    .map((v) => resolveEnumValue(v, BENEFIT_LOOKUP) ?? v)
    .filter(Boolean);

  return {
    firstName,
    middleName: middleRaw || undefined,
    lastName,
    age: row.age,
    gender: resolveEnumValue(row.gender, GENDER_LOOKUP) ?? String(row.gender ?? "").trim(),
    englishReadingProfile:
      resolveEnumValue(row.englishReadingProfile, PROFILE_LOOKUP) ??
      String(row.englishReadingProfile ?? "").trim(),
    englishFrustrationSubtypes,
    filipinoReadingProfile:
      resolveEnumValue(row.filipinoReadingProfile, PROFILE_LOOKUP) ??
      String(row.filipinoReadingProfile ?? "").trim(),
    filipinoFrustrationSubtypes,
    governmentBenefits,
    parentEducation:
      resolveEnumValue(row.parentEducation, PARENT_ED_LOOKUP) ??
      String(row.parentEducation ?? "").trim(),
    isAralLearner: parseBooleanLoose(row.isAralLearner),
    sectionName: String(row.section ?? row.Section ?? row.sectionName ?? "").trim() || undefined,
  };
}

export type ImportRowResult =
  | {
      rowNumber: number;
      ok: true;
      data: LearnerImportRow;
      duplicateWarning?: boolean;
      /** Section name present but not found in grade — imported unassigned. */
      sectionWarning?: string;
    }
  | { rowNumber: number; ok: false; errors: string[]; rawPreview: string };

export type ValidateImportRowsOptions = {
  /** Existing school learners for duplicate detection (name+age). */
  existing?: { firstName: string; lastName: string; age: number }[];
  /** When true, mark duplicates as warnings but still ok (commit will skip unless allowDuplicates). */
  flagDuplicates?: boolean;
  /**
   * Active section names in the import grade (for soft-warn on unknown names).
   * Matching is case-insensitive.
   */
  sectionNames?: string[];
};

/**
 * Validate mapped CSV rows. Empty name rows are skipped (not counted as errors).
 */
export function validateImportRows(
  rawRows: Record<string, unknown>[],
  options: ValidateImportRowsOptions = {}
): ImportRowResult[] {
  const results: ImportRowResult[] = [];
  const seenInFile = new Set<string>();
  const existing = options.existing ?? [];
  const sectionLookup = new Map(
    (options.sectionNames ?? []).map((n) => [n.trim().toLowerCase(), n])
  );

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const mapped = mapCsvRowToImportCandidate(raw);

    // Skip completely blank rows
    if (!mapped.firstName && !mapped.lastName && (mapped.age === "" || mapped.age == null)) {
      return;
    }

    const parsed = learnerImportRowSchema.safeParse(mapped);
    if (!parsed.success) {
      results.push({
        rowNumber,
        ok: false,
        errors: parsed.error.errors.map((e) => e.message),
        rawPreview: [mapped.firstName, mapped.lastName, mapped.age].filter(Boolean).join(" "),
      });
      return;
    }

    const data = parsed.data;
    const key = learnerDuplicateKey(data.firstName, data.lastName, data.age);
    let duplicateWarning = false;

    if (seenInFile.has(key)) {
      duplicateWarning = true;
    } else {
      seenInFile.add(key);
    }

    if (
      options.flagDuplicates !== false &&
      existing.some((e) =>
        isPossibleDuplicate(
          { firstName: data.firstName, lastName: data.lastName, age: data.age },
          e
        )
      )
    ) {
      duplicateWarning = true;
    }

    let sectionWarning: string | undefined;
    if (data.sectionName && options.sectionNames) {
      if (!sectionLookup.has(data.sectionName.trim().toLowerCase())) {
        sectionWarning = `Section "${data.sectionName}" not found in this grade — left unassigned`;
      }
    }

    results.push({
      rowNumber,
      ok: true,
      data: {
        ...data,
        firstName: titleCaseName(data.firstName),
        lastName: titleCaseName(data.lastName),
        middleName: data.middleName ? titleCaseName(data.middleName) : undefined,
      },
      duplicateWarning: duplicateWarning || undefined,
      sectionWarning,
    });
  });

  return results;
}

/** Resolve a section name against a list of {id,name} for the import grade. */
export function resolveSectionIdByName(
  sectionName: string | undefined,
  sections: { id: string; name: string }[]
): { sectionId: string | null; warning?: string } {
  if (!sectionName?.trim()) return { sectionId: null };
  const key = sectionName.trim().toLowerCase();
  const match = sections.find((s) => s.name.trim().toLowerCase() === key);
  if (!match) {
    return {
      sectionId: null,
      warning: `Section "${sectionName}" not found in this grade — left unassigned`,
    };
  }
  return { sectionId: match.id };
}

/** Title-case after normalize (simple word capitalise). */
export function titleCaseName(name: string): string {
  return normalizePersonName(name)
    .split(" ")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function summarizeImportResults(results: ImportRowResult[]): {
  valid: number;
  invalid: number;
  duplicateWarnings: number;
} {
  let valid = 0;
  let invalid = 0;
  let duplicateWarnings = 0;
  for (const r of results) {
    if (r.ok) {
      valid++;
      if (r.duplicateWarning) duplicateWarnings++;
    } else {
      invalid++;
    }
  }
  return { valid, invalid, duplicateWarnings };
}

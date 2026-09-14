/**
 * Pure CSV learner-import helpers (mapping, normalization, validation).
 * Commit choice: valid rows are committed; invalid rows are reported (not all-or-nothing).
 */

import {
  GOV_BENEFIT_LABELS,
  PARENT_EDUCATION_LABELS,
  READING_PROFILE_LABELS,
  READING_PROFILE_LABELS_K3,
  READING_PROFILE_LABELS_G4_PLUS,
  FRUSTRATION_SUBTYPE_LABELS,
  GENDER_LABELS,
  ETHNICITY_LABELS,
  TRANSPORTATION_LABELS,
  DISTANCE_LABELS,
  TRANSFER_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import {
  learnerImportRowSchema,
  type LearnerImportRow,
} from "@/lib/validators/learner-import.schema";
import { learnerDuplicateKey } from "@/lib/learners/normalize";
import { formatPersonName } from "@/lib/names";
import { languagesForGrade, allowedReadingValuesForGrade } from "@/lib/reading/policy";

/** Canonical CSV headers (Section A + B + optional section + isAralLearner). */
export const LEARNER_CSV_HEADERS = [
  "firstName",
  "middleName",
  "lastName",
  "age",
  "gender",
  "ethnicity",
  "ethnicityOther",
  "secondaryEthnicity",
  "secondaryEthnicityOther",
  "section",
  "englishReadingProfile",
  "englishFrustrationSubtypes",
  "filipinoReadingProfile",
  "filipinoFrustrationSubtypes",
  "governmentBenefits",
  "parentEducation",
  "modeOfTransportation",
  "distanceHomeToSchool",
  "previousTransfers",
  "transferDetails",
  "isAralLearner",
] as const;

export type LearnerCsvHeader = (typeof LEARNER_CSV_HEADERS)[number];

/** Normalize CSV header aliases (e.g. "Section" → "section"). */
export function normalizeLearnerCsvHeader(header: string): string {
  const trimmed = header.trim();
  if (trimmed.toLowerCase() === "section") return "section";
  return trimmed;
}

/**
 * CSV template. When `gradeType` is known, example profile cells use that band’s
 * human labels; otherwise enum codes (always accepted on import). Grades that
 * don't collect English (Grade 1/Grade 2) drop the `englishReadingProfile`
 * column entirely, matching what the manual form does for the same grade
 * (docs/reading-policy-spec.md section 4a).
 */
export function learnerCsvTemplate(gradeType?: string | null): string {
  const profileLabels = gradeType
    ? readingProfileLabelsForGradeType(gradeType)
    : null;
  const collectsEnglish = gradeType ? languagesForGrade(gradeType).includes("ENGLISH") : true;

  const row: Record<LearnerCsvHeader, string> = {
    firstName: "Ana",
    middleName: "M",
    lastName: "Santos",
    age: "10",
    gender: "FEMALE",
    ethnicity: "BISAYA",
    ethnicityOther: "",
    // secondaryEthnicity / secondaryEthnicityOther: optional, blank in the
    // example so nobody reads the second slot as something they must fill.
    secondaryEthnicity: "",
    secondaryEthnicityOther: "",
    section: "",
    englishReadingProfile:
      profileLabels?.INSTRUCTIONAL_DEVELOPING ?? "INSTRUCTIONAL_DEVELOPING",
    englishFrustrationSubtypes: "",
    filipinoReadingProfile:
      profileLabels?.INDEPENDENT_GRADE_READY ?? "INDEPENDENT_GRADE_READY",
    filipinoFrustrationSubtypes: "",
    governmentBenefits: "FOUR_PS",
    parentEducation: "SECONDARY_GRADUATE",
    modeOfTransportation: "WALKING",
    distanceHomeToSchool: "LESS_THAN_1KM",
    previousTransfers: "NONE",
    transferDetails: "",
    isAralLearner: "false",
  };

  const headers = collectsEnglish
    ? LEARNER_CSV_HEADERS
    : LEARNER_CSV_HEADERS.filter((h) => h !== "englishReadingProfile");

  const header = headers.join(",");
  const example = headers.map((h) => row[h]).join(",");
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
const ETHNICITY_LOOKUP = buildLookup(ETHNICITY_LABELS as Record<string, string>);
/** Accept combined + K3 + G4+ band labels (and enum codes). */
const PROFILE_LOOKUP = (() => {
  const map = buildLookup(READING_PROFILE_LABELS as Record<string, string>);
  for (const labels of [
    READING_PROFILE_LABELS_K3,
    READING_PROFILE_LABELS_G4_PLUS,
  ] as const) {
    for (const [code, label] of Object.entries(labels)) {
      map.set(normalizeKey(code), code);
      map.set(normalizeKey(label), code);
    }
  }
  return map;
})();
const FRUSTRATION_LOOKUP = buildLookup(
  FRUSTRATION_SUBTYPE_LABELS as Record<string, string>
);
const BENEFIT_LOOKUP = buildLookup(GOV_BENEFIT_LABELS as Record<string, string>);
const PARENT_ED_LOOKUP = buildLookup(PARENT_EDUCATION_LABELS as Record<string, string>);
const TRANSPORT_LOOKUP = buildLookup(TRANSPORTATION_LABELS as Record<string, string>);
const DISTANCE_LOOKUP = buildLookup(DISTANCE_LABELS as Record<string, string>);
const TRANSFER_LOOKUP = buildLookup(TRANSFER_LABELS as Record<string, string>);

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

  const transferDetailsRaw = String(row.transferDetails ?? "").trim();
  const ethnicityRaw = String(row.ethnicity ?? "").trim();
  const ethnicityOtherRaw = String(row.ethnicityOther ?? "").trim();
  const secondaryEthnicityRaw = String(row.secondaryEthnicity ?? "").trim();
  const secondaryEthnicityOtherRaw = String(row.secondaryEthnicityOther ?? "").trim();

  return {
    firstName,
    middleName: middleRaw || undefined,
    lastName,
    age: row.age,
    gender: resolveEnumValue(row.gender, GENDER_LOOKUP) ?? String(row.gender ?? "").trim(),
    ...(ethnicityRaw
      ? {
          ethnicity: resolveEnumValue(row.ethnicity, ETHNICITY_LOOKUP) ?? ethnicityRaw,
          ...(ethnicityOtherRaw ? { ethnicityOther: ethnicityOtherRaw } : {}),
        }
      : {}),
    ...(secondaryEthnicityRaw
      ? {
          secondaryEthnicity:
            resolveEnumValue(row.secondaryEthnicity, ETHNICITY_LOOKUP) ?? secondaryEthnicityRaw,
          ...(secondaryEthnicityOtherRaw
            ? { secondaryEthnicityOther: secondaryEthnicityOtherRaw }
            : {}),
        }
      : {}),
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
    modeOfTransportation:
      resolveEnumValue(row.modeOfTransportation, TRANSPORT_LOOKUP) ??
      (String(row.modeOfTransportation ?? "").trim() || undefined),
    distanceHomeToSchool:
      resolveEnumValue(row.distanceHomeToSchool, DISTANCE_LOOKUP) ??
      (String(row.distanceHomeToSchool ?? "").trim() || undefined),
    previousTransfers:
      resolveEnumValue(row.previousTransfers, TRANSFER_LOOKUP) ??
      (String(row.previousTransfers ?? "").trim() || undefined),
    transferDetails: transferDetailsRaw || undefined,
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
  /**
   * Existing school learners for duplicate detection (name+age).
   * Prefer `existingKeys` for O(1) lookups when the set is already keyed.
   */
  existing?: { firstName: string; lastName: string; age: number }[];
  /** Precomputed `learnerDuplicateKey` set (preferred over scanning `existing`). */
  existingKeys?: Set<string> | ReadonlySet<string>;
  /** When true, mark duplicates as warnings but still ok (commit will skip unless allowDuplicates). */
  flagDuplicates?: boolean;
  /**
   * Active section names in the import grade (for soft-warn on unknown names).
   * Matching is case-insensitive.
   */
  sectionNames?: string[];
  /**
   * The import's target grade type — never read from the file. When supplied,
   * each row's `englishReadingProfile`/`filipinoReadingProfile` is checked
   * against that grade's reading policy (presence and allowed values), the
   * same action-level invariant `createLearner`/`updateLearner` enforce
   * (docs/reading-policy-spec.md section 4a).
   */
  gradeType?: string;
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
  const existingKeys =
    options.existingKeys ??
    new Set(
      (options.existing ?? []).map((e) =>
        learnerDuplicateKey(e.firstName, e.lastName, e.age)
      )
    );
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

    if (options.gradeType) {
      const readingErrors = validateReadingProfileForGrade(data, options.gradeType);
      if (readingErrors.length > 0) {
        results.push({
          rowNumber,
          ok: false,
          errors: readingErrors,
          rawPreview: [mapped.firstName, mapped.lastName, mapped.age].filter(Boolean).join(" "),
        });
        return;
      }
    }

    const key = learnerDuplicateKey(data.firstName, data.lastName, data.age);
    let duplicateWarning = false;

    if (seenInFile.has(key)) {
      duplicateWarning = true;
    } else {
      seenInFile.add(key);
    }

    if (options.flagDuplicates !== false && existingKeys.has(key)) {
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

/**
 * Same action-level invariant `createLearner`/`updateLearner` enforce
 * (docs/reading-policy-spec.md section 4a), applied per CSV row at commit
 * time, keyed off the import's resolved target grade — never a grade named in
 * the file.
 */
function validateReadingProfileForGrade(
  data: { englishReadingProfile?: string; filipinoReadingProfile: string },
  gradeType: string
): string[] {
  const errors: string[] = [];
  const collectsEnglish = languagesForGrade(gradeType).includes("ENGLISH");
  const allowed = allowedReadingValuesForGrade(gradeType);

  if (collectsEnglish && !data.englishReadingProfile) {
    errors.push("English reading level is required");
  }
  if (!collectsEnglish && data.englishReadingProfile) {
    errors.push("English reading level is not collected for this grade");
  }
  if (data.englishReadingProfile && !allowed.includes(data.englishReadingProfile)) {
    errors.push("Invalid English reading level for this grade");
  }
  if (!allowed.includes(data.filipinoReadingProfile)) {
    errors.push("Invalid Filipino reading level for this grade");
  }
  return errors;
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
/**
 * Kept as a named export because the import wizard and its tests refer to it,
 * but the rules now live in one place shared with every manual entry form.
 * @see formatPersonName
 */
export function titleCaseName(name: string): string {
  return formatPersonName(name);
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

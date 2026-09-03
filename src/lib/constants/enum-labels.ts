/**
 * Human-readable labels for every Prisma enum used in the UI.
 * Keep in sync with prisma/schema.prisma.
 */

export const GRADE_LEVEL_LABELS: Record<string, string> = {
  KINDER: "Kinder",
  G1: "Grade 1",
  G2: "Grade 2",
  G3: "Grade 3",
  G4: "Grade 4",
  G5: "Grade 5",
  G6: "Grade 6",
  G7: "Grade 7",
  G8: "Grade 8",
  G9: "Grade 9",
  G10: "Grade 10",
  G11: "Grade 11",
  G12: "Grade 12",
  FLOATING: "Floating",
};

export const GRADE_LEVEL_OPTIONS = Object.entries(GRADE_LEVEL_LABELS).map(
  ([value, label]) => ({ value, label })
);

export const GENDER_LABELS = { MALE: "Male", FEMALE: "Female" } as const;

export const ATTENDANCE_STATUS_LABELS = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  EXCUSED: "Excused",
} as const;

export const READING_PROFILE_LABELS = {
  NON_DECODER_LOW_EMERGENT: "Non-Decoder / Low Emergent",
  FRUSTRATION_HIGH_EMERGENT: "Frustration / High Emergent",
  INSTRUCTIONAL_DEVELOPING: "Instructional / Developing or Transitioning",
  INDEPENDENT_GRADE_READY: "Independent / Grade-level Ready",
} as const;

/** Weekly ARAL word recognition levels (ReadingLevelRecord). */
export const WEEKLY_WORD_RECOGNITION_LEVEL_LABELS = {
  LEVEL_1: "Level 1: Can sound and name all letters only",
  LEVEL_2: "Level 2: Can read words only",
  LEVEL_3: "Level 3: Can read phrases",
  LEVEL_4: "Level 4: Can read sentences",
  LEVEL_5: "Level 5: Can read paragraphs",
  LEVEL_0: "Level 0: No mastery at all (even sounding and naming of letters)",
  NA: "N/A",
} as const;

/** Weekly ARAL reading comprehension levels (ReadingLevelRecord). */
export const WEEKLY_READING_COMPREHENSION_LEVEL_LABELS = {
  LEVEL_1: "Level 1: Can comprehend literally",
  LEVEL_2: "Level 2: Can comprehend inferentially",
  LEVEL_3: "Level 3: Can comprehend critically",
  LEVEL_0: "Level 0: No comprehension at all",
  NA: "N/A",
} as const;

/**
 * Weekly ARAL writing levels (ReadingLevelRecord.writingLevel).
 * PLACEHOLDER WORDING: unlike the word-recognition and comprehension maps above,
 * these are not yet the DepEd rubric descriptors -- the project owner supplies
 * those. Labels can change here without a migration; the enum is rubric-neutral.
 */
export const WEEKLY_WRITING_LEVEL_LABELS = {
  LEVEL_1: "Level 1",
  LEVEL_2: "Level 2",
  LEVEL_3: "Level 3",
  LEVEL_4: "Level 4",
  LEVEL_5: "Level 5",
  LEVEL_0: "Level 0",
  NA: "N/A",
} as const;

/** Kinder–G3 CRLA-style reading band labels. */
export const READING_PROFILE_LABELS_K3 = {
  NON_DECODER_LOW_EMERGENT: "Low Emergent",
  FRUSTRATION_HIGH_EMERGENT: "High Emergent",
  INSTRUCTIONAL_DEVELOPING: "Developing or Transitioning",
  INDEPENDENT_GRADE_READY: "Grade-level Ready",
} as const;

/** G4–G12 / FLOATING PHIL-IRI-style reading band labels. */
export const READING_PROFILE_LABELS_G4_PLUS = {
  NON_DECODER_LOW_EMERGENT: "Non-decoder",
  FRUSTRATION_HIGH_EMERGENT: "Frustration",
  INSTRUCTIONAL_DEVELOPING: "Instructional",
  INDEPENDENT_GRADE_READY: "Independent",
} as const;

const EARLY_GRADE_TYPES = new Set(["KINDER", "G1", "G2", "G3"]);

export function isEarlyGradeReadingBand(type: string): boolean {
  return EARLY_GRADE_TYPES.has(type);
}

export function readingProfileLabelsForGradeType(
  type: string | null | undefined
): typeof READING_PROFILE_LABELS_K3 | typeof READING_PROFILE_LABELS_G4_PLUS {
  if (type && isEarlyGradeReadingBand(type)) {
    return READING_PROFILE_LABELS_K3;
  }
  return READING_PROFILE_LABELS_G4_PLUS;
}

/** Band label when grade type is known; combined slash labels when not. */
export function labelReadingProfile(
  key: string,
  gradeType?: string | null
): string {
  if (gradeType) {
    const labels = readingProfileLabelsForGradeType(gradeType);
    return labels[key as keyof typeof labels] ?? key;
  }
  return (
    READING_PROFILE_LABELS[key as keyof typeof READING_PROFILE_LABELS] ?? key
  );
}

export const FRUSTRATION_SUBTYPE_LABELS = {
  DECODING: "Problem in Decoding",
  COMPREHENSION_ALL: "Problem in Comprehension (all levels)",
  COMPREHENSION_CRITICAL: "Problem in Comprehension (Critical only)",
} as const;

export const EDUCATIONAL_ATTAINMENT_LABELS = {
  BACHELORS: "Bachelor's Degree",
  WITH_MASTERS_UNITS: "With Master's Units",
  MASTERS: "Master's Degree",
  WITH_DOCTORAL_UNITS: "With Doctoral Units",
  DOCTORAL: "Doctoral Degree",
} as const;

export const TRAINING_LEVEL_LABELS = {
  INTERNATIONAL: "International",
  NATIONAL: "National",
  REGION: "Region",
  DIVISION: "Division",
  DISTRICT: "District",
  SCHOOL: "School",
  NA: "N/A",
} as const;

export const SCHOOL_HEAD_POSITION_LABELS = {
  TEACHER_I_TIC: "Teacher I (TIC)",
  TEACHER_II_TIC: "Teacher II (TIC)",
  TEACHER_III_TIC: "Teacher III (TIC)",
  TEACHER_IV_TIC: "Teacher IV (TIC)",
  TEACHER_V_TIC: "Teacher V (TIC)",
  HEAD_TEACHER_I: "Head Teacher I",
  HEAD_TEACHER_II: "Head Teacher II",
  HEAD_TEACHER_III: "Head Teacher III",
  HEAD_TEACHER_IV: "Head Teacher IV",
  HEAD_TEACHER_V: "Head Teacher V",
  HEAD_TEACHER_VI: "Head Teacher VI",
  HEAD_TEACHER_VII: "Head Teacher VII",
  PRINCIPAL_I: "Principal I",
  PRINCIPAL_II: "Principal II",
  PRINCIPAL_III: "Principal III",
  PRINCIPAL_IV: "Principal IV",
  TECHVOC_AD: "TECHVOC Ad",
} as const;

/**
 * Whether a teacher holds a DepEd plantilla item. A different axis from
 * `TEACHER_POSITION_LABELS`, which records the rank of such an item.
 *
 * Short by design: these read as a chip beside a name in the ARAL tutor picker,
 * where "Non-DepEd (volunteer, LGU-funded, private hire…)" would crowd out the
 * teacher it describes.
 */
export const EMPLOYMENT_TYPE_LABELS = {
  DEPED_PLANTILLA: "DepEd",
  NON_DEPED: "Non-DepEd",
} as const;

export const TEACHER_POSITION_LABELS = {
  TEACHER_I: "Teacher I",
  TEACHER_II: "Teacher II",
  TEACHER_III: "Teacher III",
  TEACHER_IV: "Teacher IV",
  TEACHER_V: "Teacher V",
  TEACHER_VI: "Teacher VI",
  TEACHER_VII: "Teacher VII",
  MASTER_TEACHER_I: "Master Teacher I",
  MASTER_TEACHER_II: "Master Teacher II",
  MASTER_TEACHER_III: "Master Teacher III",
  MASTER_TEACHER_IV: "Master Teacher IV",
} as const;

export const SPECIALIZATION_LABELS = {
  GENERAL_EDUCATION: "General Education",
  ENGLISH: "English",
  MATH: "Math",
  SCIENCE: "Science",
  FILIPINO: "Filipino",
  TLE_EPP: "TLE/EPP",
  ARALPAN: "ARALPAN",
  MAPEH: "MAPEH",
  TECHVOC: "TechVoc",
  VALUES_ED: "Values Ed",
  OTHERS: "Others",
  NA: "N/A",
} as const;

export const SUBJECT_LABELS = {
  ENGLISH: "English",
  MATH: "Math",
  SCIENCE: "Science",
  FILIPINO: "Filipino",
  TLE_EPP: "TLE/EPP",
  ARALPAN: "ARALPAN",
  MAPEH: "MAPEH",
  TECHVOC: "TechVoc",
  VALUES_ED: "Values Ed",
  ABM: "ABM",
} as const;

/**
 * The learning areas an end-of-term grade sheet records. Separate from
 * `SUBJECT_LABELS`, which is a teacher-survey artifact the schema marks for
 * removal — a live feature must not depend on it.
 */
export const LEARNING_AREA_LABELS = {
  ENGLISH: "English",
  FILIPINO: "Filipino",
  MATHEMATICS: "Mathematics",
  SCIENCE: "Science",
  ARALING_PANLIPUNAN: "Araling Panlipunan",
  EDUKASYON_SA_PAGPAPAKATAO: "Edukasyon sa Pagpapakatao",
  MAPEH: "MAPEH",
  TLE: "TLE",
} as const;

/** Column order for the term grade sheet and its export. */
export const LEARNING_AREA_ORDER = [
  "ENGLISH",
  "FILIPINO",
  "MATHEMATICS",
  "SCIENCE",
  "ARALING_PANLIPUNAN",
  "EDUKASYON_SA_PAGPAPAKATAO",
  "MAPEH",
  "TLE",
] as const;

export const READING_TRAINING_LABELS = {
  ARAL: "ARAL",
  TEACHING_READING: "Teaching Reading",
  ELLN: "ELLN",
  TEACEP: "TEACEP",
  NONE: "None at all",
} as const;

export const ENGLISH_TRAINING_LABELS = {
  MATATAG_TRAINING: "Matatag Training",
  UPSKILLING_ENGLISH_COMPETENCE: "Upskilling of English Competence",
  NONE: "None at all",
} as const;

export const GOV_BENEFIT_LABELS = {
  FOUR_PS: "4Ps",
  IPS: "IPs",
} as const;

export const ETHNICITY_LABELS = {
  BISAYA: "Bisaya",
  ILONGGO: "Ilonggo",
  BLAAN: "Blaan",
  TAGAKAOLO: "Tagakaolo",
  TBOLI: "T'boli",
  BADJAO: "Badjao",
  MARANAO: "Maranao",
  TAUSOG: "Tausog",
  MAGUINDANAON: "Maguindanaon",
  ILOCANO: "Ilocano",
  TAGALOG: "Tagalog",
  FOREIGN: "Foreign",
  OTHER: "Others (please specify)",
} as const;

/** Display ethnicity, substituting the free text when "Others" was chosen. */
export function formatEthnicity(
  ethnicity: string | null | undefined,
  ethnicityOther: string | null | undefined,
  fallback = "—"
): string {
  if (!ethnicity) return fallback;
  if (ethnicity === "OTHER") return ethnicityOther?.trim() || "Others";
  return ETHNICITY_LABELS[ethnicity as keyof typeof ETHNICITY_LABELS] ?? ethnicity;
}

export const PARENT_EDUCATION_LABELS = {
  NO_FORMAL: "No formal Education",
  ELEMENTARY_LEVEL: "Elementary Level",
  ELEMENTARY_GRADUATE: "Elementary Graduate",
  SECONDARY_LEVEL: "Secondary Level",
  SECONDARY_GRADUATE: "Secondary Graduate",
  COLLEGE_LEVEL: "College Level",
  COLLEGE_GRADUATE: "College Graduate",
} as const;

export const TRANSPORTATION_LABELS = {
  WALKING: "Walking",
  MOTORCYCLE: "Motorcycle",
  BUS_JEEP_CAR: "Bus / Jeep / Car",
} as const;

export const DISTANCE_LABELS = {
  LESS_THAN_1KM: "Less than 1 km",
  ONE_TO_FIVE_KM: "1–5 km",
  MORE_THAN_5KM: "More than 5 km",
} as const;

export const TRANSFER_LABELS = {
  NONE: "No transfers",
  ONE: "1 transfer",
  MULTIPLE: "Multiple transfers",
} as const;

export const ABSENTEEISM_LABELS = {
  ONE_TO_THREE_PER_MONTH: "1–3 days per month",
  THREE_TO_FIVE_PER_MONTH: "3–5 days per month",
  MORE_THAN_FIVE_PER_MONTH: "More than 5 days per month",
  WEEKLY: "Consistently absent every week",
  OTHER: "Other (specify reason)",
} as const;

export const LETTER_RECOGNITION_LABELS = {
  ALL_EASY: "Recognizes all letters with ease",
  CONFUSES_SIMILAR: "Confuses similar-looking letters (e.g., b/d, p/q, m/n)",
  STRUGGLES_RECALL: "Struggles to recall letter names",
  NA: "N/A",
} as const;

export const LETTER_SOUND_LABELS = {
  ACCURATE: "Accurately connects letters to sounds",
  INCONSISTENT: "Inconsistently identifies letter sounds",
  UNABLE: "Unable to associate letters with sounds",
  NA: "N/A",
} as const;

export const WORD_RECOGNITION_LABELS = {
  READS_HF_FLUENT: "Reads high-frequency words fluently",
  GUESSES: "Relies on guessing rather than decoding",
  OMITS_ADDS_REPLACES: "Omits, adds, or replaces letters in words",
  STRUGGLES_SIGHT_WORDS: "Struggles to recognize common sight words",
  NA: "N/A",
} as const;

export const HOME_LITERACY_LABELS = {
  HAS_ACCESS: "Has access to books and reading materials",
  LIMITED: "Limited exposure to books at home",
  NONE: "No reading materials available",
  NA: "N/A",
} as const;

export const PARENTAL_SUPPORT_LABELS = {
  REGULAR: "Parents/guardians regularly assist with reading",
  LIMITED: "Parents/guardians have limited involvement",
  NONE: "No support available at home",
  NA: "N/A",
} as const;

export const CLASSROOM_ENV_LABELS = {
  SMALL_CLASS: "Small class size (individualized attention possible)",
  LARGE_CLASS: "Large class size (limited teacher attention)",
  NA: "N/A",
} as const;

export const LANGUAGE_CONSIDERATION_LABELS = {
  MATCHES_LOI: "Primary language at home matches the language of instruction",
  DIFFERENT_DIALECT: "Learner speaks a different dialect/language at home",
  STRUGGLES_TRANSITION: "Struggles with language transition in school",
  NA: "N/A",
} as const;

export const INTERVENTION_LABELS = {
  PHONEMIC_AWARENESS: "Phonemic awareness activities",
  LETTER_SOUND_DRILLS: "Letter-sound correspondence drills",
  SIGHT_WORD_PRACTICE: "Sight word recognition practice",
  STRUCTURED_PHONICS: "Structured phonics instruction",
  ONE_ON_ONE: "One-on-one reading support",
  HOME_READING: "Home reading program",
  LSEN_OTHER: "Need for other intervention (LSENs — specify)",
} as const;

export const FURTHER_ASSESSMENT_LABELS = {
  MFAT: "MFAT (Multifactor Assessment Tool)",
  OTHER: "Other (specify)",
} as const;

export function toOptions<T extends Record<string, string>>(labels: T) {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const TERM_PERIOD_LABELS = {
  FIRST: "First Term",
  SECOND: "Second Term",
  THIRD: "Third Term",
} as const;

/** Reports Hub: what a generated report covers, and the file it produced. */
export const REPORT_KIND_LABELS = {
  ATTENDANCE: "Attendance",
  READING_LEVEL: "Reading Level",
  TERM_GRADES: "Grades",
  TEACHER_SUMMARY: "Teacher Summary",
  CLASS_ROSTER: "Class Roster",
  CUSTOM: "Custom",
} as const;

export const REPORT_FORMAT_LABELS = {
  EXCEL: "Excel",
  PDF: "PDF",
} as const;

export const SUPPORT_TICKET_CATEGORY_LABELS = {
  UNLOCK_REQUEST: "Request access",
  SYSTEM_ASSISTANCE: "System assistance",
  BUG_REPORT: "Something is broken",
  ACCOUNT_ACCESS: "Account access",
  OTHER: "Other",
} as const;

export const SUPPORT_TICKET_STATUS_LABELS = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  DECLINED: "Declined",
} as const;

export const UNLOCK_SCOPE_LABELS = {
  ARAL_WEEKLY_ATTENDANCE: "Weekly ARAL attendance",
  TERM_GRADES: "Term grade sheet",
} as const;

/**
 * `UserRole`, as a person is named in the UI.
 *
 * "Division admin" rather than "Super admin": that is what the role is called to
 * the schools it serves, and it is the phrase the assistant and the support
 * inbox both use when they say who answered a request.
 */
export const USER_ROLE_LABELS = {
  SUPER_ADMIN: "Division admin",
  SCHOOL_HEAD: "School Head",
  TEACHER: "Teacher",
} as const;

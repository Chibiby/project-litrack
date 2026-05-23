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

export const YEARS_IN_SERVICE_LABELS = {
  Y0_3: "0–3 years",
  Y4_10: "4–10 years",
  Y11_20: "11–20 years",
  Y21_PLUS: "21 years and above",
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

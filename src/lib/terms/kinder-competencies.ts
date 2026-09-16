/**
 * The Kindergarten End-of-Term progress-report competency catalog — the
 * DepEd form's four domains, transcribed verbatim (including the source's
 * own wording). Fixed in code by the project owner's decision: this is not a
 * School Head or Super Admin configurable list the way `TermSubject` is.
 *
 * Each rated entry carries a STABLE `key` (`"<roman numeral>.<item number>"`,
 * or `"<roman numeral>.<item number><sub-item letter>"` for Domain IV's item
 * 13) that gets persisted with every saved rating. Keys are never derived
 * from array position — reordering this file, or DepEd revising the form's
 * wording, must never re-point a stored rating at a different competency.
 * Do not renumber or reassign an existing key.
 *
 * No Prisma, no React, no `server-only` — importable from both server and
 * client, in the spirit of `src/lib/terms/subjects.ts` and
 * `src/lib/aral/reading-level-stats.ts`.
 */

import type { KINDER_COMPETENCY_RATING_LABELS as _KinderCompetencyRatingLabels } from "@/lib/constants/enum-labels";

/**
 * The 62 rated rows, in display order. This is the single source of truth:
 * `KINDER_COMPETENCY_CATALOG` below composes its domain/section/group
 * structure by looking entries up from this list, so the text below is
 * never duplicated.
 */
export const KINDER_COMPETENCY_ENTRIES = [
  // I. Sensory Perceptual and Motor Development
  { key: "I.1", domain: "I", number: 1, text: "Identifies external body parts and their functions" },
  { key: "I.2", domain: "I", number: 2, text: "Identifies ways to care for and protects one's body" },
  { key: "I.3", domain: "I", number: 3, text: "Demonstrates gross motor skills (locomotor, non-locomotor)" },
  { key: "I.4", domain: "I", number: 4, text: "Moves body parts as directed" },
  { key: "I.5", domain: "I", number: 5, text: "Demonstrates fine motor skills (tearing, cutting, rolling molding with playdough)" },

  // II. Socio-emotional Development
  { key: "II.1", domain: "II", number: 1, text: "Identifies and expresses feelings in appropriate ways" },
  { key: "II.2", domain: "II", number: 2, text: "Recognizes and respects feelings of others" },
  { key: "II.3", domain: "II", number: 3, text: "Expresses needs and preferences" },
  { key: "II.4", domain: "II", number: 4, text: "Behaves appropriately in different situations" },
  { key: "II.5", domain: "II", number: 5, text: "Participates in classroom routines and activities" },
  { key: "II.6", domain: "II", number: 6, text: "Follows classroom and school rules" },
  { key: "II.7", domain: "II", number: 7, text: "Fulfills classroom responsibilities" },

  // III. Cognitive Development
  { key: "III.1", domain: "III", number: 1, text: "Identifies attributes of objects (colors, shape, size)" },
  { key: "III.2", domain: "III", number: 2, text: "Matches objects based on attributes" },
  { key: "III.3", domain: "III", number: 3, text: "Describes objects based on attributes (shape, color, taste, texture)" },
  { key: "III.4", domain: "III", number: 4, text: "Classifies objects by a single attribute (colors, shape, size)" },
  { key: "III.5", domain: "III", number: 5, text: "Reclassifies objects according to specific attributes" },
  { key: "III.6", domain: "III", number: 6, text: "Arranges objects according to specific attributes" },
  { key: "III.7", domain: "III", number: 7, text: "Recognizes, extends and creates patterns using concrete objects" },
  { key: "III.8", domain: "III", number: 8, text: "Measures size, length, capacity and mass of objects using non-standard measuring tools" },
  { key: "III.9", domain: "III", number: 9, text: "Identifies position of objects (in, on, over, under, top, bottom)" },
  { key: "III.10", domain: "III", number: 10, text: "Compares quantities of objects (more/ less)" },
  { key: "III.11", domain: "III", number: 11, text: "Counts with one-to-one correspondence" },
  { key: "III.12", domain: "III", number: 12, text: "Recognizes numerals" },
  { key: "III.13", domain: "III", number: 13, text: "Matches numerals to objects" },
  { key: "III.14", domain: "III", number: 14, text: "Adds and subtracts using concrete objects" },
  { key: "III.15", domain: "III", number: 15, text: "Recognizes clock as measure of time (hours and minutes)" },
  { key: "III.16", domain: "III", number: 16, text: "Shows awareness and care for the natural and physical environment" },
  { key: "III.17", domain: "III", number: 17, text: "Talks about participation in cultural and religious activities" },
  { key: "III.18", domain: "III", number: 18, text: "Shows awareness of the importance of caring for the natural and physical environment through simple practices (e.g., sorting trash, helping to clean up)" },
  { key: "III.19", domain: "III", number: 19, text: "Predicts outcomes in familiar stories read aloud in class" },
  { key: "III.20", domain: "III", number: 20, text: "Suggests solutions to problems in class activities and stories read aloud in class" },

  // IV. Language, Literacy, and Communication Development
  // A. Listening and Viewing
  { key: "IV.1", domain: "IV", number: 1, text: "Identifies familiar environmental sound" },
  { key: "IV.2", domain: "IV", number: 2, text: "Recalls what happens first, middle and end in a story" },
  { key: "IV.3", domain: "IV", number: 3, text: "Retells story in sequence" },
  { key: "IV.4", domain: "IV", number: 4, text: "Follows 1-2 step instructions" },
  // B. Sight Word Recognition
  { key: "IV.5", domain: "IV", number: 5, text: "Recognizes non-decodable words in and out of context automatically" },
  { key: "IV.6", domain: "IV", number: 6, text: "Recognizes sight words" },
  // C. Speaking
  { key: "IV.7", domain: "IV", number: 7, text: "Identifies first and last name" },
  { key: "IV.8", domain: "IV", number: 8, text: "Identifies classmates, teachers, family member" },
  { key: "IV.9", domain: "IV", number: 9, text: "Identifies familiar objects at home, in school and in the community" },
  { key: "IV.10", domain: "IV", number: 10, text: "Uses polite greetings and courteous expressions in varied situations" },
  { key: "IV.11", domain: "IV", number: 11, text: "Retells personal experiences to story events" },
  { key: "IV.12", domain: "IV", number: 12, text: "Expresses ideas and feelings using phrases and simple sentences" },
  // D. Reading — Phonological/ Phonemic Awareness (item 13 is a stem; its
  // three sub-items are the rated rows)
  { key: "IV.13a", domain: "IV", number: 13, subLetter: "a", text: "syllable" },
  { key: "IV.13b", domain: "IV", number: 13, subLetter: "b", text: "onset and rime" },
  { key: "IV.13c", domain: "IV", number: 13, subLetter: "c", text: "phoneme by phoneme" },
  // D. Reading — Letter Knowledge
  { key: "IV.14", domain: "IV", number: 14, text: "Identifies uppercase letters" },
  { key: "IV.15", domain: "IV", number: 15, text: "Identifies lowercase letters" },
  { key: "IV.16", domain: "IV", number: 16, text: "Matches upper and lowercase letters" },
  // D. Reading — Letter Sound Relationship
  { key: "IV.17", domain: "IV", number: 17, text: "Identifies letter sounds" },
  { key: "IV.18", domain: "IV", number: 18, text: "Matches letters and their corresponding sounds" },
  // E. Comprehension
  { key: "IV.19", domain: "IV", number: 19, text: "Uses a variety of strategies to gain meaning of leveled texts" },
  { key: "IV.20", domain: "IV", number: 20, text: "Uses print and illustrations to make meaning" },
  // F. Concepts of Print
  { key: "IV.21", domain: "IV", number: 21, text: "Demonstrates book handling skills" },
  { key: "IV.22", domain: "IV", number: 22, text: "Distinguishes between letters, words, and sentences" },
  { key: "IV.23", domain: "IV", number: 23, text: "Demonstrates awareness of print (left to right and top to bottom)" },
  // G. Writing
  { key: "IV.24", domain: "IV", number: 24, text: "Traces/ draws/ copies shapes, designs, pictures" },
  { key: "IV.25", domain: "IV", number: 25, text: "Traces/ copies/ write name, words" },
  { key: "IV.26", domain: "IV", number: 26, text: "Writes uppercase and lowercase letters" },
  { key: "IV.27", domain: "IV", number: 27, text: "Spells sight words" },
  { key: "IV.28", domain: "IV", number: 28, text: "Spells simple words phonetically" },
] as const satisfies readonly {
  key: string;
  domain: "I" | "II" | "III" | "IV";
  number: number;
  subLetter?: "a" | "b" | "c";
  text: string;
}[];

/**
 * The repo's one place that means "is this grade Kindergarten" (see this
 * module's header, section 2 of docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md).
 * `gradeType` must come from an authorized placement (`AdvisoryPlacement.gradeType`)
 * or a DB-loaded `GradeLevel.type` row — never a client-submitted value. Every
 * call site that needs this check must call this function rather than writing
 * `=== "KINDER"` locally. `EARLY_RUBRIC_GRADE_TYPES`
 * (`src/lib/reading/policy.ts`) is a different concern and is left as is.
 */
const KINDER_GRADE_TYPES: ReadonlySet<string> = new Set(["KINDER"]);

export function isKinderGradeType(gradeType: string): boolean {
  return KINDER_GRADE_TYPES.has(gradeType);
}

/** Every stored `KinderCompetencyRating.competencyKey` value, forever. */
export type KinderCompetencyKey = (typeof KINDER_COMPETENCY_ENTRIES)[number]["key"];

/**
 * One catalog entry, widened from `(typeof KINDER_COMPETENCY_ENTRIES)[number]`
 * so `subLetter` is a uniformly optional field on every entry rather than a
 * key present only on the three Domain IV item-13 sub-entries' own literal
 * types — a union of the narrower per-object literal types disallows reading
 * `.subLetter` off a value typed as the union itself.
 */
export type KinderCompetencyEntry = {
  key: KinderCompetencyKey;
  domain: "I" | "II" | "III" | "IV";
  number: number;
  subLetter?: "a" | "b" | "c";
  text: string;
};

/** Same order as `KINDER_COMPETENCY_ENTRIES` — kept as an explicit export so callers don't reach past the catalog's intended entry point. */
export const KINDER_COMPETENCY_ENTRIES_IN_ORDER: readonly KinderCompetencyEntry[] =
  KINDER_COMPETENCY_ENTRIES;

/** Never hardcode 62 — this is the number of rated rows a saved sheet must cover. */
export const KINDER_COMPETENCY_COUNT = KINDER_COMPETENCY_ENTRIES.length;

/** key -> entry, for the save action to resolve/validate incoming ratings. */
export const KINDER_COMPETENCY_BY_KEY: ReadonlyMap<KinderCompetencyKey, KinderCompetencyEntry> =
  new Map(KINDER_COMPETENCY_ENTRIES.map((entry) => [entry.key, entry]));

const KINDER_COMPETENCY_KEY_SET: ReadonlySet<string> = new Set(
  KINDER_COMPETENCY_ENTRIES.map((entry) => entry.key)
);

/** Type guard for values arriving from the client (form data, JSON body). */
export function isKinderCompetencyKey(value: string): value is KinderCompetencyKey {
  return KINDER_COMPETENCY_KEY_SET.has(value);
}

// ---------------------------------------------------------------------------
// Display structure: domains -> (Domain IV only) lettered sections ->
// (Domain IV section D only) unnumbered sub-headings -> rated entries, with
// item 13's stem text carried alongside its three sub-items.
// ---------------------------------------------------------------------------

/** One line in a section/group: either a directly-rated entry, or item 13's stem plus its three rated sub-entries. */
export type KinderCompetencyLine =
  | { kind: "entry"; entry: KinderCompetencyEntry }
  | { kind: "stem"; number: number; text: string; subEntries: readonly KinderCompetencyEntry[] };

/** A run of lines under one optional unnumbered sub-heading (only Domain IV section D has more than one of these). */
export type KinderCompetencyGroup = {
  subHeading: string | null;
  lines: readonly KinderCompetencyLine[];
};

/** A lettered section (Domain IV only). Plain domains have no sections at all. */
export type KinderCompetencySection = {
  letter: string;
  title: string;
  groups: readonly KinderCompetencyGroup[];
};

export type KinderCompetencyDomain = {
  roman: "I" | "II" | "III" | "IV";
  title: string;
  /** Domains I-III have no lettered sections: their rated entries sit directly in one ungrouped run. */
  groups: readonly KinderCompetencyGroup[];
  sections: readonly KinderCompetencySection[];
};

function byKey(key: KinderCompetencyKey): KinderCompetencyEntry {
  const entry = KINDER_COMPETENCY_BY_KEY.get(key);
  if (!entry) {
    throw new Error(`kinder-competencies: missing catalog entry for key "${key}"`);
  }
  return entry;
}

function entryLine(key: KinderCompetencyKey): KinderCompetencyLine {
  return { kind: "entry", entry: byKey(key) };
}

function ungroupedRun(keys: readonly KinderCompetencyKey[]): readonly KinderCompetencyGroup[] {
  return [{ subHeading: null, lines: keys.map(entryLine) }];
}

export const KINDER_COMPETENCY_CATALOG: readonly KinderCompetencyDomain[] = [
  {
    roman: "I",
    title: "Sensory Perceptual and Motor Development",
    groups: ungroupedRun(["I.1", "I.2", "I.3", "I.4", "I.5"]),
    sections: [],
  },
  {
    roman: "II",
    title: "Socio-emotional Development",
    groups: ungroupedRun(["II.1", "II.2", "II.3", "II.4", "II.5", "II.6", "II.7"]),
    sections: [],
  },
  {
    roman: "III",
    title: "Cognitive Development",
    groups: ungroupedRun([
      "III.1", "III.2", "III.3", "III.4", "III.5", "III.6", "III.7", "III.8",
      "III.9", "III.10", "III.11", "III.12", "III.13", "III.14", "III.15",
      "III.16", "III.17", "III.18", "III.19", "III.20",
    ]),
    sections: [],
  },
  {
    roman: "IV",
    title: "Language, Literacy, and Communication Development",
    groups: [],
    sections: [
      {
        letter: "A",
        title: "Listening and Viewing",
        groups: ungroupedRun(["IV.1", "IV.2", "IV.3", "IV.4"]),
      },
      {
        letter: "B",
        title: "Sight Word Recognition",
        groups: ungroupedRun(["IV.5", "IV.6"]),
      },
      {
        letter: "C",
        title: "Speaking",
        groups: ungroupedRun(["IV.7", "IV.8", "IV.9", "IV.10", "IV.11", "IV.12"]),
      },
      {
        letter: "D",
        title: "Reading",
        groups: [
          {
            subHeading: "Phonological/ Phonemic Awareness",
            lines: [
              {
                kind: "stem",
                number: 13,
                text: "Orally segment sounds",
                subEntries: [byKey("IV.13a"), byKey("IV.13b"), byKey("IV.13c")],
              },
            ],
          },
          {
            subHeading: "Letter Knowledge",
            lines: ["IV.14", "IV.15", "IV.16"].map((k) => entryLine(k as KinderCompetencyKey)),
          },
          {
            subHeading: "Letter Sound Relationship",
            lines: ["IV.17", "IV.18"].map((k) => entryLine(k as KinderCompetencyKey)),
          },
        ],
      },
      {
        letter: "E",
        title: "Comprehension",
        groups: ungroupedRun(["IV.19", "IV.20"]),
      },
      {
        letter: "F",
        title: "Concepts of Print",
        groups: ungroupedRun(["IV.21", "IV.22", "IV.23"]),
      },
      {
        letter: "G",
        title: "Writing",
        groups: ungroupedRun(["IV.24", "IV.25", "IV.26", "IV.27", "IV.28"]),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Rating scale
//
// The `KinderCompetencyRating` enum's UI labels live in
// `src/lib/constants/enum-labels.ts`, per CLAUDE.md's rule that every Prisma
// enum's UI label belongs there. Re-exported here so callers of this catalog
// module don't also need to import enum-labels.ts for the rating scale.
// ---------------------------------------------------------------------------

export {
  KINDER_COMPETENCY_RATING_LABELS,
  KINDER_COMPETENCY_RATING_SHORT_LABELS,
} from "@/lib/constants/enum-labels";

/** One of the three stored `KinderCompetencyRating` enum values. */
export type KinderCompetencyRatingCode = keyof typeof _KinderCompetencyRatingLabels;

import { LEARNING_AREA_LABELS } from "@/lib/constants/enum-labels";

/**
 * The key one End of Terms subject is compared by across schools (spec 4.3).
 *
 * Each school edits its own subject list, so "the same subject" is decided
 * here, in one place:
 * 1. A seeded default carries `TermSubject.legacyArea` — that area is the key,
 *    however the school renamed the row.
 * 2. A School Head-created subject has no area — its name, trimmed,
 *    single-spaced and lower-cased, is the key.
 * 3. A legacy grade row with no `termSubjectId` uses `TermGrade.subject`.
 *
 * Area keys and name keys live in different namespaces (`area:` / `name:`), so
 * a school subject literally named "english" never merges into the ENGLISH area
 * by accident of spelling.
 */
export type SubjectSource = {
  legacyArea: string | null;
  name: string | null;
  legacySubject: string | null;
};

export function subjectKey(source: SubjectSource): string | null {
  if (source.legacyArea) return `area:${source.legacyArea}`;
  const folded = (source.name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  if (folded) return `name:${folded}`;
  if (source.legacySubject) return `area:${source.legacySubject}`;
  return null;
}

/**
 * Display name for a subject key: the `LEARNING_AREA_LABELS` label for an area
 * key, otherwise the most common spelling seen (ties: alphabetical).
 */
export function subjectLabel(key: string, spellings: ReadonlyMap<string, number>): string {
  if (key.startsWith("area:")) {
    const area = key.slice("area:".length);
    return LEARNING_AREA_LABELS[area as keyof typeof LEARNING_AREA_LABELS] ?? area;
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const [spelling, count] of spellings) {
    if (count > bestCount || (count === bestCount && best !== null && spelling < best)) {
      best = spelling;
      bestCount = count;
    }
  }
  return best ?? key.slice("name:".length);
}

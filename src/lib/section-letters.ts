/**
 * Letter-named section helpers (A–Z), shared by section actions and school structure bootstrap.
 */

/** Next unused single letter A–Z among active section names (case-insensitive). */
export function nextUnusedLetter(names: string[]): string | null {
  const used = letterNameSet(names);
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return null;
}

/** Count of active names that are a single letter A–Z. */
export function countLetterSections(names: string[]): number {
  return letterNameSet(names).size;
}

/**
 * Letters still needed so the grade has at least `targetCount` active sections.
 * Counts all existing section names toward the floor; only unused A–Z letters are added.
 * Does not remove or rename existing sections.
 */
export function lettersNeededToReachCount(
  existingNames: string[],
  targetCount: number
): string[] {
  if (targetCount <= 0) return [];
  const used = letterNameSet(existingNames);
  const needed = Math.max(0, Math.min(26, targetCount) - existingNames.length);
  if (needed === 0) return [];

  const out: string[] = [];
  for (let i = 0; i < 26 && out.length < needed; i++) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) {
      out.push(letter);
      used.add(letter);
    }
  }
  return out;
}

function letterNameSet(names: string[]): Set<string> {
  return new Set(
    names
      .map((n) => n.trim().toUpperCase())
      .filter((n) => /^[A-Z]$/.test(n))
  );
}

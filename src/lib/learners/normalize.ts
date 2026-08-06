/**
 * Pure helpers for learner duplicate detection (trim + case-fold + collapse spaces).
 */

export function normalizePersonName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Stable key: normalized first|last|age */
export function learnerDuplicateKey(
  firstName: string,
  lastName: string,
  age: number
): string {
  return `${normalizePersonName(firstName)}|${normalizePersonName(lastName)}|${age}`;
}

/** True when two name+age triples match after normalization. */
export function isPossibleDuplicate(
  a: { firstName: string; lastName: string; age: number },
  b: { firstName: string; lastName: string; age: number }
): boolean {
  return learnerDuplicateKey(a.firstName, a.lastName, a.age) ===
    learnerDuplicateKey(b.firstName, b.lastName, b.age);
}

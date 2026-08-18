/**
 * Pure helpers behind the login district filter. Extracted from the form so the
 * narrowing and stale-selection rules can be tested without rendering React.
 */

/** Radix Select cannot hold an empty-string item value, so the "all" case needs a sentinel. */
export const ALL_DISTRICTS = "__all__";

export type SchoolOption = {
  id: string;
  name: string;
  district: string | null;
  teachersOpen: boolean;
};

export function deriveDistricts(schools: SchoolOption[]): string[] {
  const seen = new Set<string>();
  for (const s of schools) {
    const d = s.district?.trim();
    if (d) seen.add(d);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * District is an optional narrowing filter, never a gate. Schools with no district
 * are reachable only under "All districts" — they belong to no specific one.
 */
export function schoolsInDistrict(schools: SchoolOption[], district: string): SchoolOption[] {
  if (district === ALL_DISTRICTS) return schools;
  return schools.filter((s) => s.district?.trim() === district);
}

/** A selection surviving a filter change that hides it is a defect, so drop it. */
export function clearStaleSchool(selectedId: string, visible: SchoolOption[]): string {
  if (!selectedId) return "";
  return visible.some((s) => s.id === selectedId) ? selectedId : "";
}

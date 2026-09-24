import type { AdminScope } from "@/lib/auth/admin-scope";

/** "Alabel 1 and Alabel 2" / "Alabel 1, Alabel 2 and Glan 1". */
export function joinDistricts(districts: readonly string[]): string {
  if (districts.length <= 1) return districts[0] ?? "";
  return `${districts.slice(0, -1).join(", ")} and ${districts[districts.length - 1]}`;
}

/** One line naming what the signed-in admin supervises, for page subtitles. */
export function describeScope(scope: AdminScope): string {
  if (scope.kind === "division") return "Every school in the division";
  if (scope.districts.length === 0) return "No districts assigned yet";
  return `Schools in ${joinDistricts(scope.districts)}`;
}

export function hasNoDistricts(scope: AdminScope): boolean {
  return scope.kind === "districts" && scope.districts.length === 0;
}

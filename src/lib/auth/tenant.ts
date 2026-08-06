import "server-only";

/**
 * Tenant isolation helper. Throws a generic "Not found" on school mismatch
 * to avoid leaking whether a resource exists in another tenant.
 */
export function assertSameSchool(
  userSchoolId: string,
  resourceSchoolId: string | null | undefined
): void {
  if (!resourceSchoolId || resourceSchoolId !== userSchoolId) {
    throw new Error("Not found");
  }
}

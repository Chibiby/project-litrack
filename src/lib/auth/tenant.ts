import "server-only";
import { resourceNotFound } from "@/lib/errors/app-error";

/**
 * Tenant isolation.
 *
 * A row from another school and a row that does not exist produce the SAME
 * message, so existence in another tenant never leaks. Only the admin record
 * tells them apart: a cross-tenant attempt is severity "security" and carries
 * both school ids in `detail`, which is the signal actually worth reviewing.
 */
export function assertSameSchool(
  userSchoolId: string,
  resourceSchoolId: string | null | undefined,
  resource = "Record"
): void {
  if (!resourceSchoolId) throw resourceNotFound(resource);
  if (resourceSchoolId !== userSchoolId) {
    throw resourceNotFound(resource, {
      crossTenant: true,
      detail: `${resource} belongs to school ${resourceSchoolId}; requested from school ${userSchoolId}`,
    });
  }
}

import "server-only";
import type { AdminScope } from "@/lib/auth/admin-scope";
import type { DistrictOption, SchoolOption } from "@/lib/admin/management";
import { resolveScopeSchools } from "@/lib/summary/scope-schools";

/**
 * The district and school filters of a district admin's Management page,
 * cut to their own districts.
 *
 * `districts` is the tenancy fence every query receives; it comes from
 * `requireAdminScope`, never the request. A requested `district` or `schoolId`
 * outside the fence is dropped (the list then shows every in-scope school),
 * so a hand-edited URL can narrow the list but never widen it.
 */
export type DistrictListContext = {
  districts: readonly string[];
  district: string | undefined;
  schoolId: string | undefined;
  districtOptions: DistrictOption[];
  /** In-scope schools, narrowed to `district` when one is chosen. */
  schoolOptions: SchoolOption[];
  /** True when the admin has more than one district, so a District filter helps. */
  showDistrictFilter: boolean;
};

export async function districtListContext(
  scope: AdminScope,
  requested: { district?: string; schoolId?: string }
): Promise<DistrictListContext> {
  // `requireAdminScope` gives a district admin `kind: "districts"`; anything
  // else reaching a /district page gets an empty fence, which matches nothing.
  const districts = scope.kind === "districts" ? scope.districts : [];
  const schools =
    scope.kind === "districts" ? await resolveScopeSchools(scope, true) : [];

  const district =
    requested.district && districts.includes(requested.district) ? requested.district : undefined;
  const inDistrict = district ? schools.filter((s) => s.district === district) : schools;
  const schoolId =
    requested.schoolId && inDistrict.some((s) => s.id === requested.schoolId)
      ? requested.schoolId
      : undefined;

  const counts = new Map<string, number>();
  for (const s of schools) if (s.district) counts.set(s.district, (counts.get(s.district) ?? 0) + 1);

  return {
    districts,
    district,
    schoolId,
    districtOptions: [...districts]
      .sort((a, b) => a.localeCompare(b))
      .map((d) => ({ district: d, schools: counts.get(d) ?? 0 })),
    schoolOptions: inDistrict.map((s) => ({
      id: s.id,
      name: s.name,
      schoolIdCode: s.schoolIdCode,
      district: s.district,
    })),
    showDistrictFilter: districts.length > 1,
  };
}

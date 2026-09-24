"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatPersonName,
  formatOptionalPersonName,
  buildFullName,
} from "@/lib/names";
import { requireSchoolUser } from "@/lib/auth/session";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
import {
  updateSchoolInfoSchema,
  setSchoolActiveSchema,
  adminProfileSchema,
  adminSchoolEditBasicSchema,
  adminSchoolEditFullSchema,
} from "@/lib/validators/school.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { action } from "@/lib/errors/action";
import { resourceNotFound, fieldError } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import {
  revalidateSchoolDashboard,
  revalidateSchoolsList,
  revalidateDivisionSummary,
} from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { DISTRICT_ROUTES } from "@/lib/routes/district";

type ActionResult = { ok: true } | { ok: false; error: string };

// ── Shared write body: School Head's own school, and the admin/district edit ──

/**
 * What `applySchoolInfoUpdate` is allowed to write, picked by which validator
 * the caller used. `basic` is the district admin's shape (`name`, `address`
 * only); `full` is the Super Admin's superset, which also carries `region`,
 * `division` and `district` — see `docs/specs/district-admin.md` 3.5 and 3.7.
 */
type SchoolInfoUpdateFields =
  | { editable: "basic"; name: string; address?: string }
  | {
      editable: "full";
      name: string;
      address?: string;
      region?: string;
      division?: string;
      district?: string;
    };

type SchoolInfoActor = {
  userId: string;
  /**
   * Recorded on the audit row only for a district admin acting on a school
   * they do not head — the "reused actions ... add actorRole to the
   * metadata" rule (spec 3.5). A School Head editing their own school, or the
   * Super Admin (already implied by every existing `SCHOOL_UPDATE` row),
   * needs no extra marker.
   */
  actorRole?: "DISTRICT_ADMIN";
};

/**
 * The one write body behind both `updateSchoolInfo` (School Head, own school)
 * and `updateSchoolAsAdmin` (Super Admin / district admin, any in-scope
 * school): the name-uniqueness check and the `SCHOOL_UPDATE` audit row live
 * here so the two callers cannot drift (spec 3.5).
 *
 * Callers own their own auth guard and ownership/scope check — this function
 * only re-verifies that `schoolId` still names a live school (reading the
 * `district` it had before the write, for the audit row's `districtFrom`),
 * and that no other live school already holds the requested name.
 */
async function applySchoolInfoUpdate(
  schoolId: string,
  fields: SchoolInfoUpdateFields,
  actor: SchoolInfoActor
): Promise<void> {
  const current = await prisma.school.findFirst({
    where: { id: schoolId, deletedAt: null },
    select: { district: true },
  });
  if (!current) throw resourceNotFound("School");

  const nameTaken = await prisma.school.findFirst({
    where: { name: fields.name, deletedAt: null, NOT: { id: schoolId } },
    select: { id: true },
  });
  if (nameTaken) throw fieldError("name", "A school with this name already exists");

  const data: Prisma.SchoolUpdateInput = {
    name: fields.name,
    address: fields.address ?? null,
  };
  if (fields.editable === "full") {
    data.region = fields.region ?? null;
    data.division = fields.division ?? null;
    data.district = fields.district ?? null;
  }

  await prisma.school.update({ where: { id: schoolId }, data });

  const districtTo = fields.editable === "full" ? (fields.district ?? null) : current.district;

  await writeAudit({
    userId: actor.userId,
    schoolId,
    action: AUDIT_ACTIONS.SCHOOL_UPDATE,
    resource: "School",
    resourceId: schoolId,
    metadata: {
      schoolId,
      name: fields.name,
      fields:
        fields.editable === "full"
          ? ["name", "address", "region", "division", "district"]
          : ["name", "address"],
      districtFrom: current.district,
      districtTo,
      ...(actor.actorRole ? { actorRole: actor.actorRole } : {}),
    },
  });
}

/**
 * School Head: update school display fields (not schoolIdCode).
 *
 * `region`, `division` and `district` are no longer read from `formData` at
 * all — `updateSchoolInfoSchema` does not have those keys, so a stale cached
 * form that still posts them simply has the extra fields dropped by Zod
 * before this ever sees them. See `updateSchoolInfoSchema` for why.
 */
export const updateSchoolInfo = action(
  "updateSchoolInfo",
  async (formData: FormData): Promise<{ ok: true }> => {
    const user = await requireSchoolUser("SCHOOL_HEAD");

    const parsed = parseInput(updateSchoolInfoSchema, {
      name: formData.get("name"),
      address: formData.get("address") || undefined,
    });

    await applySchoolInfoUpdate(
      user.schoolId,
      { editable: "basic", name: parsed.name, address: parsed.address },
      { userId: user.id }
    );

    revalidatePath(SCHOOL_HEAD_ROUTES.schoolInfo);
    revalidateSchoolDashboard(user.schoolId);
    revalidateSchoolsList();
    return { ok: true };
  },
  { verb: "update the school" }
);

/**
 * Super Admin or district admin: edit one in-scope school's info.
 *
 * Authorization and tenant story: `requireAdminScope()` proves the caller is
 * either the Super Admin (whole division) or a district admin (their own
 * districts only) — never `requireUser("DISTRICT_ADMIN")` alone, which would
 * let a Super Admin through implicitly with no explicit branch (spec I8).
 * `loadSchoolInScope` then puts the scope in the `WHERE` of the one query that
 * loads the target row: an out-of-scope `schoolId` is NOT_FOUND before any
 * validator that could reveal which fields exist is even chosen, and before
 * any write, so a district admin probing another district's school id learns
 * nothing (spec I7).
 *
 * Which validator applies is picked from `scope.kind`, never a role flag the
 * client could send: a district admin's payload is parsed with
 * `adminSchoolEditBasicSchema` (name + address only), so `region`, `division`
 * and `district` are not even accepted keys for that caller — the same "the
 * shape itself refuses it" pattern as `updateSchoolInfoSchema` above. Only the
 * Super Admin's `adminSchoolEditFullSchema` branch may move a school's
 * district (spec I11).
 */
export const updateSchoolAsAdmin = action(
  "updateSchoolAsAdmin",
  async (formData: FormData): Promise<{ ok: true }> => {
    const { user, scope } = await requireAdminScope();

    if (scope.kind === "division") {
      const parsed = parseInput(adminSchoolEditFullSchema, {
        schoolId: formData.get("schoolId"),
        name: formData.get("name"),
        address: formData.get("address") || undefined,
        region: formData.get("region") || undefined,
        division: formData.get("division") || undefined,
        district: formData.get("district") || undefined,
      });
      const school = await loadSchoolInScope(scope, parsed.schoolId, { id: true });

      await applySchoolInfoUpdate(
        school.id,
        {
          editable: "full",
          name: parsed.name,
          address: parsed.address,
          region: parsed.region,
          division: parsed.division,
          district: parsed.district,
        },
        { userId: user.id }
      );

      revalidateSchoolInfoWrites(school.id);
      return { ok: true };
    }

    const parsed = parseInput(adminSchoolEditBasicSchema, {
      schoolId: formData.get("schoolId"),
      name: formData.get("name"),
      address: formData.get("address") || undefined,
    });
    const school = await loadSchoolInScope(scope, parsed.schoolId, { id: true });

    await applySchoolInfoUpdate(
      school.id,
      { editable: "basic", name: parsed.name, address: parsed.address },
      { userId: user.id, actorRole: "DISTRICT_ADMIN" }
    );

    revalidateSchoolInfoWrites(school.id);
    return { ok: true };
  },
  { verb: "update the school" }
);

function revalidateSchoolInfoWrites(schoolId: string) {
  revalidatePath("/admin/schools");
  revalidatePath(DISTRICT_ROUTES.schools);
  revalidatePath(DISTRICT_ROUTES.school(schoolId));
  revalidateSchoolDashboard(schoolId);
  revalidateSchoolsList();
  revalidateDivisionSummary();
}

/**
 * Super Admin or district admin: activate or deactivate a school (soft
 * archival via `isActive`).
 *
 * Same scope story as `updateSchoolAsAdmin` above: `requireAdminScope()` for
 * an explicit Super-Admin-or-district-admin branch, `loadSchoolInScope` puts
 * the scope in the `WHERE`, and an out-of-scope `schoolId` is NOT_FOUND before
 * any update, Supabase or audit call runs (spec T3).
 */
export const setSchoolActive = action(
  "setSchoolActive",
  async (formData: FormData): Promise<{ ok: true }> => {
    const { user, scope } = await requireAdminScope();

    const parsed = parseInput(setSchoolActiveSchema, {
      schoolId: formData.get("schoolId"),
      isActive: formData.get("isActive"),
    });

    const school = await loadSchoolInScope(scope, parsed.schoolId, { id: true });

    await prisma.school.update({
      where: { id: school.id },
      data: { isActive: parsed.isActive },
    });

    await writeAudit({
      userId: user.id,
      schoolId: school.id,
      action: AUDIT_ACTIONS.SCHOOL_SET_ACTIVE,
      resource: "School",
      resourceId: school.id,
      metadata: {
        schoolId: school.id,
        isActive: parsed.isActive,
        ...(user.role === "DISTRICT_ADMIN" ? { actorRole: user.role } : {}),
      },
    });

    revalidatePath("/admin/schools");
    revalidatePath(DISTRICT_ROUTES.schools);
    revalidatePath(DISTRICT_ROUTES.school(school.id));
    revalidateSchoolsList();
    revalidateSchoolDashboard(school.id);
    revalidateDivisionSummary();
    return { ok: true };
  },
  { verb: "update the school" }
);

/**
 * Super Admin or district admin: update the caller's own display name
 * fields. `requireAdminScope()` only proves an admin scope exists — this
 * action never reads `scope` because it always writes `admin.id`, the
 * caller's own row, never a `schoolId` or another user's id from the client.
 */
export async function updateAdminProfile(formData: FormData): Promise<ActionResult> {
  const { user: admin } = await requireAdminScope();

  const parsed = adminProfileSchema.safeParse({
    firstName: formData.get("firstName"),
    middleName: formData.get("middleName") || undefined,
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const firstName = formatPersonName(parsed.data.firstName);
  const lastName = formatPersonName(parsed.data.lastName);
  const middleName = formatOptionalPersonName(parsed.data.middleName) ?? null;
  const fullName = buildFullName(firstName, middleName, lastName);

  await prisma.user.update({
    where: { id: admin.id },
    data: { firstName, middleName, lastName, fullName },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: null,
    action: AUDIT_ACTIONS.ADMIN_PROFILE_UPDATE,
    resource: "User",
    resourceId: admin.id,
    metadata: { userId: admin.id },
  });

  revalidatePath("/admin/settings/profile");
  revalidatePath(DISTRICT_ROUTES.settingsProfile);
  return { ok: true };
}

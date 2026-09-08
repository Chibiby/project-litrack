"use server";export async function resetDemoData(formData: FormData): Promise<
  ActionResult<{ count: number; initialPassword: string }>
> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = resetDemoSchema.safeParse({ confirm: formData.get("confirm") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const before = await prisma.school.findMany({
    where: { isDemo: true },
    select: { id: true },
  });

  let result;
  try {
    result = await resetDemoTenant(admin.id);
  } catch (err) {
    console.error("[demo] reset failed:", err);
    return { ok: false, error: "Could not reset the demo data. Check the server logs." };
  }
  if (!result.ok) return result;

  await writeAudit({
    userId: admin.id,
    schoolId: null,
    action: AUDIT_ACTIONS.DEMO_RESET,
    resource: "School",
    resourceId: null,
    metadata: {
      removedSchoolIds: before.map((s) => s.id),
      createdSchoolIds: result.schools.map((s) => s.schoolId),
    },
  });

  revalidateDemoSurfaces();
  return {
    ok: true,
    data: { count: result.schools.length, initialPassword: result.initialPassword },
  };
}

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { writeSetting } from "@/lib/settings/system-settings";
import { DEMO_ENABLED_KEY } from "@/lib/demo/constants";
import { provisionDemoTenant, resetDemoTenant } from "@/lib/demo/provision";
import { setDemoModeSchema, resetDemoSchema } from "@/lib/validators/demo.schema";
import {
  revalidateAdminDashboard,
  revalidateSchoolsList,
} from "@/lib/cache/revalidate";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const DEMO_SETTINGS_PATH = "/admin/settings/demo";

/**
 * Bust every cache entry whose contents depend on whether the demo tenant is
 * visible.
 *
 * `schoolsList` is the important one: the login page's school dropdown is a
 * 60-second `cachedQuery` under that tag, so without this the switch would look
 * broken for up to a minute on the one page it most obviously affects. The
 * admin dashboard aggregates are tagged separately and exclude demo counts, so
 * they are busted too.
 */
function revalidateDemoSurfaces() {
  revalidateSchoolsList();
  revalidateAdminDashboard();
  revalidatePath(DEMO_SETTINGS_PATH);
  revalidatePath("/admin/schools");
  revalidatePath("/login");
}

/**
 * Super Admin: show or hide the demo district, school and accounts.
 *
 * Purely a visibility switch — no row is created, deleted or modified beyond the
 * one settings row, so turning it back on restores the demo exactly as it was,
 * mid-recording state included.
 */
export async function setDemoMode(formData: FormData): Promise<ActionResult> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = setDemoModeSchema.safeParse({ enabled: formData.get("enabled") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  try {
    await writeSetting(DEMO_ENABLED_KEY, parsed.data.enabled ? "true" : "false");
  } catch (err) {
    console.error("[demo] setDemoMode write failed:", err);
    return { ok: false, error: "Could not save the setting. Please try again." };
  }

  await writeAudit({
    userId: admin.id,
    schoolId: null,
    action: AUDIT_ACTIONS.DEMO_MODE_SET,
    resource: "SystemSetting",
    resourceId: DEMO_ENABLED_KEY,
    metadata: { enabled: parsed.data.enabled },
  });

  revalidateDemoSurfaces();
  return { ok: true };
}

/**
 * Super Admin: create the demo district, school (ID 123456) and School Head.
 *
 * Idempotent — calling it when the demo tenant already exists returns the
 * existing credentials rather than creating a second one. The initial password
 * is returned once, for the admin to read on camera; it is never stored in
 * Prisma, exactly as with `createSchool`.
 */
export async function createDemoData(): Promise<
  ActionResult<{ count: number; initialPassword: string }>
> {
  const admin = await requireUser("SUPER_ADMIN");

  let result;
  try {
    result = await provisionDemoTenant(admin.id);
  } catch (err) {
    console.error("[demo] provision failed:", err);
    return { ok: false, error: "Could not create the demo data. Check the server logs." };
  }
  if (!result.ok) return result;

  await writeAudit({
    userId: admin.id,
    // The demo set spans several schools, so no single one owns this row.
    schoolId: null,
    action: AUDIT_ACTIONS.DEMO_PROVISION,
    resource: "School",
    resourceId: null,
    // Ids and a count only. No password: it is the School ID, already on each
    // School row, and audit metadata is read back in two UIs.
    metadata: { schoolIds: result.schools.map((s) => s.schoolId), count: result.schools.length },
  });

  revalidateDemoSurfaces();
  return {
    ok: true,
    data: { count: result.schools.length, initialPassword: result.initialPassword },
  };
}



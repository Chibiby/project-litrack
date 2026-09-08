"use server";

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
  ActionResult<{ schoolId: string; initialPassword: string; schoolHeadEmail: string }>
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
    schoolId: result.schoolId,
    action: AUDIT_ACTIONS.DEMO_PROVISION,
    resource: "School",
    // No password in metadata — it is the School ID, already on the School row.
    resourceId: result.schoolId,
    metadata: { schoolId: result.schoolId },
  });

  revalidateDemoSurfaces();
  return {
    ok: true,
    data: {
      schoolId: result.schoolId,
      initialPassword: result.initialPassword,
      schoolHeadEmail: result.schoolHeadEmail,
    },
  };
}

/**
 * Super Admin: throw the demo tenant away and build a clean one.
 *
 * Destructive and not undoable, which is why it is confirmation-gated on both
 * ends. It can only ever reach a school whose `isDemo` is true; the id is looked
 * up server-side from that flag and never accepted from the form.
 */
export async function resetDemoData(formData: FormData): Promise<
  ActionResult<{ schoolId: string; initialPassword: string; schoolHeadEmail: string }>
> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = resetDemoSchema.safeParse({ confirm: formData.get("confirm") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const before = await prisma.school.findFirst({
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
    schoolId: result.schoolId,
    action: AUDIT_ACTIONS.DEMO_RESET,
    resource: "School",
    resourceId: result.schoolId,
    metadata: { removedSchoolId: before?.id ?? null, createdSchoolId: result.schoolId },
  });

  revalidateDemoSurfaces();
  return {
    ok: true,
    data: {
      schoolId: result.schoolId,
      initialPassword: result.initialPassword,
      schoolHeadEmail: result.schoolHeadEmail,
    },
  };
}

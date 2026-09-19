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
import { clearDemoSessionCookie, setDemoSessionCookie } from "@/lib/demo/session";
import { provisionDemoTenant, resetDemoTenant } from "@/lib/demo/provision";
import { prepareTestLabFixtures, type TestLabFixtures } from "@/lib/demo/test-fixtures";
import { resetDemoSchema } from "@/lib/validators/demo.schema";
import { action } from "@/lib/errors/action";
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
 * Cache keys already carry the demo flag (see `listSchoolsWithTeacherStatus`),
 * so a stale entry can never be served to the wrong audience. This exists so
 * the surfaces that just changed for THIS browser — the login dropdowns, the
 * admin dashboard counts, the settings page itself — repaint immediately
 * instead of after the 60-second TTL.
 */
function revalidateDemoSurfaces() {
  revalidateSchoolsList();
  revalidateAdminDashboard();
  revalidatePath(DEMO_SETTINGS_PATH);
  revalidatePath("/admin/schools");
  revalidatePath("/login");
}

/**
 * Super Admin: open a demo session in this browser.
 *
 * The demo tenant is visible to a request, never to a deployment. Opening a
 * session writes the signed cookie from `@/lib/demo/session`, and from then on
 * this browser — and only this browser — sees the demo district and its schools
 * in the login dropdowns and may sign in to them. Everyone else keeps seeing
 * the system as if the training data did not exist, which is the whole point:
 * the old global switch put "[demo school 1]" in front of every real teacher
 * for as long as it stayed on.
 *
 * The session ends when the admin ends it, when anyone signs out in this
 * browser (`logoutAction` clears the cookie), when the browser closes, or at
 * the signed expiry — whichever comes first.
 */
export async function startDemoSession(): Promise<ActionResult<{ expiresAt: number }>> {
  const admin = await requireUser("SUPER_ADMIN");

  let session;
  try {
    session = await setDemoSessionCookie(admin.id);
  } catch (err) {
    // The only failure here is a missing SUPABASE_SERVICE_ROLE_KEY, which is a
    // deployment problem the admin cannot fix from this page.
    console.error("[demo] could not open a demo session:", err);
    return { ok: false, error: "Could not open a demo session. Check the server configuration." };
  }

  await writeAudit({
    userId: admin.id,
    schoolId: null,
    action: AUDIT_ACTIONS.DEMO_SESSION_START,
    resource: "DemoSession",
    resourceId: null,
    metadata: { expiresAt: new Date(session.expiresAt).toISOString() },
  });

  revalidateDemoSurfaces();
  return { ok: true, data: { expiresAt: session.expiresAt } };
}

/**
 * End the demo session in this browser.
 *
 * Deliberately not gated on SUPER_ADMIN. Ending only ever hides demo data, and
 * the person clicking it may by then be signed in as the demo School Head —
 * which is exactly the state this button exists to get out of. Requiring the
 * admin role would strand them in the demo until the cookie expired.
 */
export async function endDemoSession(): Promise<ActionResult> {
  await clearDemoSessionCookie();
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

export type PrepareTestLabResult = { ok: true; fixtures: TestLabFixtures };

/**
 * Super Admin: build (or complete) Page Test Lab's fixtures inside the one
 * live demo school (docs/test-lab-spec.md, T2/T3).
 *
 * `prepareTestLabFixtures` re-checks the school itself via
 * `assertTestableSchool` before any write, so this can never reach a real
 * school even if `findDemoSchools()` were ever wrong. Idempotent — calling it
 * again completes whatever is missing and creates nothing that already exists.
 */
export const prepareTestLab = action(
  "prepareTestLab",
  async (): Promise<PrepareTestLabResult> => {
    const admin = await requireUser("SUPER_ADMIN");
    const fixtures = await prepareTestLabFixtures(admin.id);
    revalidatePath("/admin/test-lab");
    return { ok: true, fixtures };
  },
  { verb: "prepare the test data" }
);


import "server-only";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

/**
 * Session-like window for ADMIN_SCHOOL_VIEW dedupe.
 * Choice: once per admin+school within 8 hours — not every SH page navigation.
 * Avoids audit spam when Super Admin browses grade-levels → teachers → audit, etc.
 */
const ADMIN_VIEW_AUDIT_WINDOW_MS = 8 * 60 * 60 * 1000;

/**
 * Resolve target school for School Head pages.
 * Super Admin must pass ?schoolId=; School Head uses their own school.
 */
export async function resolveSchoolContext(
  user: User,
  schoolIdParam: string | undefined,
  path: string
): Promise<{ schoolId: string; isSuperAdminView: boolean }> {
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (isSuperAdmin) {
    if (!schoolIdParam) {
      redirect("/admin/schools");
    }

    // Audit is best-effort — pool timeouts must not block the dashboard.
    try {
      const since = new Date(Date.now() - ADMIN_VIEW_AUDIT_WINDOW_MS);
      const alreadyLogged = await prisma.auditLog.findFirst({
        where: {
          userId: user.id,
          schoolId: schoolIdParam,
          action: AUDIT_ACTIONS.ADMIN_SCHOOL_VIEW,
          timestamp: { gte: since },
        },
        select: { id: true },
      });

      if (!alreadyLogged) {
        await writeAudit({
          userId: user.id,
          schoolId: schoolIdParam,
          action: AUDIT_ACTIONS.ADMIN_SCHOOL_VIEW,
          resource: "School",
          resourceId: schoolIdParam,
          metadata: { schoolId: schoolIdParam, path },
        });
      }
    } catch (err) {
      console.error("[resolveSchoolContext] ADMIN_SCHOOL_VIEW audit failed:", err);
    }

    return { schoolId: schoolIdParam, isSuperAdminView: true };
  }

  if (!user.schoolId) redirect("/login");
  return { schoolId: user.schoolId, isSuperAdminView: false };
}

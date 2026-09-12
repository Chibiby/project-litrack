import "server-only";

import { prisma } from "@/lib/prisma";

/**
 * A school can contain historical duplicate School Head rows. Sign-in always
 * uses the oldest live row, so every reset, reveal, and impersonation control
 * must resolve the same row through this module.
 */
export async function findSignInSchoolHead(schoolId: string) {
  return prisma.user.findFirst({
    where: {
      schoolId,
      role: "SCHOOL_HEAD",
      deletedAt: null,
      isActive: true,
      school: { deletedAt: null },
    },
    select: { id: true, authId: true, email: true, schoolId: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Resolve the sign-in row for every school on one accounts page in one query.
 * The first row for each school is the same oldest-live row selected above.
 */
export async function findSignInSchoolHeadIds(schoolIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(schoolIds)];
  if (ids.length === 0) return new Set();

  const rows = await prisma.user.findMany({
    where: {
      schoolId: { in: ids },
      role: "SCHOOL_HEAD",
      deletedAt: null,
      isActive: true,
      school: { deletedAt: null },
    },
    select: { id: true, schoolId: true },
    orderBy: [{ schoolId: "asc" }, { createdAt: "asc" }],
  });

  const firstBySchool = new Map<string, string>();
  for (const row of rows) {
    if (row.schoolId && !firstBySchool.has(row.schoolId)) {
      firstBySchool.set(row.schoolId, row.id);
    }
  }
  return new Set(firstBySchool.values());
}

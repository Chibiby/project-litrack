import "server-only";
import { Prisma, type GradeLevelType, type PrismaClient } from "@prisma/client";
import { orderSheetSubjects } from "@/lib/terms/subjects";

type Client = PrismaClient | Prisma.TransactionClient;

export type TermSubjectDefaultRow = {
  id: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

const SELECT = { id: true, name: true, position: true, deletedAt: true } as const;

/**
 * Every template row (active + archived) for one `GradeLevelType`.
 *
 * `TermSubjectDefault` is tenant-less — there is no `schoolId` to scope this
 * by, and `gradeLevelType` is the whole scope. Callers that need only the
 * active, ordered set should use `getActiveDefaultsForType`
 * (`src/lib/terms/subjects-db.ts`) instead of filtering this themselves.
 */
export async function getAllTermSubjectDefaults(
  client: Client,
  gradeLevelType: GradeLevelType
): Promise<TermSubjectDefaultRow[]> {
  return client.termSubjectDefault.findMany({
    where: { gradeLevelType },
    select: SELECT,
  });
}

/**
 * The Super Admin management page's view of one grade type: active in
 * display order, then archived (most recently archived first) — the same
 * shape `getManagedTermSubjects` returns for a school's own subjects.
 */
export async function getManagedTermSubjectDefaults(
  client: Client,
  gradeLevelType: GradeLevelType
): Promise<{ active: TermSubjectDefaultRow[]; archived: TermSubjectDefaultRow[] }> {
  const rows = await getAllTermSubjectDefaults(client, gradeLevelType);
  const archived = rows
    .filter((r): r is TermSubjectDefaultRow & { deletedAt: Date } => r.deletedAt !== null)
    .sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime());
  return { active: orderSheetSubjects(rows), archived };
}

import "server-only";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolsList } from "@/lib/cache/tags";
import type { SchoolRow } from "@/components/schools-table";

/** Admin schools table rows — Data Cache keyed by `schools-list`. */
export function getSchoolsList(): Promise<SchoolRow[]> {
  return cachedQuery(
    async () => {
      const schools = await prisma.school.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          schoolIdCode: true,
          region: true,
          division: true,
          isActive: true,
          _count: { select: { users: true, learners: true } },
        },
      });
      return schools.map((s) => ({
        ...s,
        users: s._count.users,
        learners: s._count.learners,
      }));
    },
    {
      keyParts: ["schools-list"],
      tags: [schoolsList],
      revalidate: 60,
    }
  );
}

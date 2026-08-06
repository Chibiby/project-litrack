import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolName as schoolNameTag } from "@/lib/cache/tags";

/**
 * School name lookup: React `cache()` dedupes within one RSC request;
 * `unstable_cache` keeps results across navigations until tag/TTL bust.
 */
export const getSchoolName = cache(
  async (schoolId: string): Promise<string | null> => {
    return cachedQuery(
      async () => {
        const school = await prisma.school.findUnique({
          where: { id: schoolId },
          select: { name: true },
        });
        return school?.name ?? null;
      },
      {
        keyParts: ["school-name", schoolId],
        tags: [schoolNameTag(schoolId)],
        revalidate: 300,
      }
    );
  }
);

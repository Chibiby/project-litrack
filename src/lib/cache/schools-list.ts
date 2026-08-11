import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolsList } from "@/lib/cache/tags";
import type { SchoolRow } from "@/components/schools-table";

export const SCHOOLS_PAGE_SIZE = 10;

export type SchoolsListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  region: string;
};

export type SchoolsListPage = {
  rows: SchoolRow[];
  totalCount: number;
};

/**
 * Parse admin schools table query params (?page=&q=&region=).
 * Pure — no I/O.
 */
export function parseSchoolsListParams(
  searchParams: { page?: string; q?: string; region?: string },
  pageSize: number = SCHOOLS_PAGE_SIZE
): SchoolsListParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const region = (searchParams.region ?? "").trim();
  const size = pageSize > 0 ? pageSize : SCHOOLS_PAGE_SIZE;
  const skip = (page - 1) * size;
  return { page, pageSize: size, skip, take: size, q, region };
}

export function schoolsTotalPages(
  totalCount: number,
  pageSize: number = SCHOOLS_PAGE_SIZE
): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

function schoolsWhere(params: Pick<SchoolsListParams, "q" | "region">): Prisma.SchoolWhereInput {
  const where: Prisma.SchoolWhereInput = { deletedAt: null };
  if (params.region) {
    where.region = params.region;
  }
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: "insensitive" } },
      { schoolIdCode: { contains: params.q, mode: "insensitive" } },
      { division: { contains: params.q, mode: "insensitive" } },
      { region: { contains: params.q, mode: "insensitive" } },
    ];
  }
  return where;
}

/**
 * Admin schools table page — Data Cache keyed by `schools-list` + page/q/region.
 */
export function getSchoolsListPage(
  params: SchoolsListParams
): Promise<SchoolsListPage> {
  const { skip, take, q, region, page, pageSize } = params;
  return cachedQuery(
    async () => {
      const where = schoolsWhere({ q, region });
      const [schools, totalCount] = await Promise.all([
        prisma.school.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take,
          select: {
            id: true,
            name: true,
            schoolIdCode: true,
            region: true,
            division: true,
            isActive: true,
            _count: { select: { users: true, learners: true } },
          },
        }),
        prisma.school.count({ where }),
      ]);
      return {
        totalCount,
        rows: schools.map((s) => ({
          ...s,
          users: s._count.users,
          learners: s._count.learners,
        })),
      };
    },
    {
      keyParts: [
        "schools-list",
        `p:${page}`,
        `ps:${pageSize}`,
        `q:${q}`,
        `r:${region}`,
      ],
      tags: [schoolsList],
      revalidate: 60,
    }
  );
}

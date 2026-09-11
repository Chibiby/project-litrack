import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";

/**
 * Super Admin school-account console data.
 *
 * Deliberately NOT run through `cachedQuery`. Every other admin list is a
 * read-mostly view where a 60s stale window is invisible; this one drives
 * credential actions, and an admin who has just reset a password must see the
 * new state on the very next render or they will reset it again. The page is
 * `force-dynamic` and Super-Admin-only, so the query cost is a non-issue.
 */

export const SCHOOL_ACCOUNTS_PAGE_SIZE = 10;

export type SchoolAccountRow = {
  schoolId: string;
  schoolName: string;
  schoolIdCode: string;
  /**
   * What the head signs in with while `passwordIsSchoolId` holds: the bare DepEd
   * School ID. Differs from `schoolIdCode` only for an extension school, whose
   * stored code carries a `-N` suffix (see `defaultSchoolHeadPassword`).
   */
  defaultPassword: string;
  schoolIsActive: boolean;
  region: string | null;
  division: string | null;
  /** Null when a school somehow has no School Head row — surfaced, not hidden. */
  head: {
    id: string;
    email: string;
    fullName: string;
    isActive: boolean;
    /**
     * True when the live password is `defaultPassword`, i.e. the one case where
     * the console can display a credential that actually works. False means
     * user-chosen or a random one-time credential — unreadable either way.
     */
    passwordIsSchoolId: boolean;
    /**
     * True when LITRACK holds a sealed copy of the head's own password, so the
     * console can offer to reveal it.
     *
     * A boolean, never the ciphertext: the row goes to the browser, and the
     * password itself only travels in the response to an explicit, audited
     * `revealSchoolHeadPassword` call. False is the permanent state for every
     * password chosen before sealing existed.
     */
    passwordStored: boolean;
    mustChangePassword: boolean;
  } | null;
};

export type SchoolAccountsParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
};

export function parseSchoolAccountsParams(
  searchParams: { page?: string; q?: string },
  pageSize: number = SCHOOL_ACCOUNTS_PAGE_SIZE
): SchoolAccountsParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const size = pageSize > 0 ? pageSize : SCHOOL_ACCOUNTS_PAGE_SIZE;
  return { page, pageSize: size, skip: (page - 1) * size, take: size, q };
}

export function schoolAccountsTotalPages(
  totalCount: number,
  pageSize: number = SCHOOL_ACCOUNTS_PAGE_SIZE
): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

function schoolAccountsWhere(q: string): Prisma.SchoolWhereInput {
  const where: Prisma.SchoolWhereInput = { deletedAt: null };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { schoolIdCode: { contains: q, mode: "insensitive" } },
      { division: { contains: q, mode: "insensitive" } },
      { region: { contains: q, mode: "insensitive" } },
    ];
  }
  return where;
}

export async function getSchoolAccountsPage(
  params: SchoolAccountsParams
): Promise<{ rows: SchoolAccountRow[]; totalCount: number }> {
  const where = schoolAccountsWhere(params.q);

  const [schools, totalCount] = await Promise.all([
    prisma.school.findMany({
      where,
      orderBy: { name: "asc" },
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        name: true,
        schoolIdCode: true,
        isActive: true,
        region: true,
        division: true,
        users: {
          // `take: 1` with the same ordering `findSchoolHead` uses in the
          // actions, so the row shown is always the row the actions will act on.
          where: { role: "SCHOOL_HEAD", deletedAt: null },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            email: true,
            fullName: true,
            firstName: true,
            lastName: true,
            isActive: true,
            passwordIsSchoolId: true,
            // Selected only to be turned into a boolean below. It must not
            // reach the client component.
            passwordVaultCipher: true,
            mustChangePassword: true,
          },
        },
      },
    }),
    prisma.school.count({ where }),
  ]);

  return {
    totalCount,
    rows: schools.map((school) => {
      const head = school.users[0];
      return {
        schoolId: school.id,
        schoolName: school.name,
        schoolIdCode: school.schoolIdCode,
        defaultPassword: defaultSchoolHeadPassword(school.schoolIdCode),
        schoolIsActive: school.isActive,
        region: school.region,
        division: school.division,
        head: head
          ? {
              id: head.id,
              email: head.email,
              fullName:
                head.fullName || `${head.firstName} ${head.lastName}`.trim() || school.name,
              isActive: head.isActive,
              passwordIsSchoolId: head.passwordIsSchoolId,
              passwordStored: head.passwordVaultCipher !== null,
              mustChangePassword: head.mustChangePassword,
            }
          : null,
      };
    }),
  };
}

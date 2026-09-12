import "server-only";
import type { Prisma, TeacherApprovalStatus, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { findSignInSchoolHeadIds } from "@/lib/auth/school-head-sign-in";

/**
 * Super Admin accounts console read model.
 *
 * Deliberately NOT run through `cachedQuery`, for the same reason recorded in
 * the read model this replaces (`src/lib/admin/school-accounts.ts`): this list
 * drives credential actions (reveal / reset / impersonate), and an admin who
 * has just reset a password must see the new state on the very next render or
 * they will reset it again. The page is `force-dynamic` and Super-Admin-only,
 * and the query below is bounded at 3 Prisma calls regardless of row count, so
 * the cost of skipping the cache is a non-issue.
 *
 * The 3-call bound is load-bearing: a production outage was
 * caused by an admin list page that fanned out queries per row against a pool
 * whose `connection_limit` is floored at 3. Nothing in this module may add a
 * per-row query, a per-row `await` inside `.map()`, or a per-row Supabase Admin
 * call — that is strictly worse than a query, it is an HTTP round trip.
 */

export const ACCOUNTS_PAGE_SIZE = 20;

/**
 * The Password cell, a discriminated union computed once here so the table
 * only ever renders what it is given, never re-derives it.
 *
 * A teacher (or Super Admin) row can only ever be `never_stored`: the branch
 * that produces `sealed` / `school_id` / `not_recorded` sits inside the
 * `role === "SCHOOL_HEAD"` check in `accountPasswordState` below, so nothing
 * else can reach it.
 */
export type AccountPasswordState =
  | { kind: "school_id"; value: string }
  | { kind: "sealed" }
  | { kind: "not_recorded" }
  | { kind: "never_stored" };

/** What the account signs in with — a username for Super Admin, an email otherwise. */
export type AccountSignIn =
  | { kind: "username"; value: string }
  | { kind: "email"; value: string; synthetic: boolean };

export type AccountRow = {
  id: string;
  role: UserRole;
  fullName: string;
  schoolId: string | null;
  school: { id: string; name: string; schoolIdCode: string } | null;
  signIn: AccountSignIn;
  isActive: boolean;
  mustChangePassword: boolean;
  /** Teacher self-registration status; null for SCHOOL_HEAD / SUPER_ADMIN rows. */
  approvalStatus: TeacherApprovalStatus | null;
  password: AccountPasswordState;
  /** True only for the oldest active School Head row used by school sign-in. */
  signInHead: boolean;
  /**
   * True when `email` is a real mailbox, i.e. NOT synthetic. Computed once
   * here from `isSyntheticEmail` — the table must not re-derive this from the
   * address string, because the "no mailbox" chip and the reset-vs-recover
   * hint both depend on this one decision agreeing everywhere.
   */
  canRecoverByEmail: boolean;
};

export type AccountsParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  role?: UserRole;
  schoolId?: string;
};

const ROLE_VALUES: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_HEAD", "TEACHER"];

function isUserRole(value: string | undefined): value is UserRole {
  return value !== undefined && (ROLE_VALUES as readonly string[]).includes(value);
}

export function parseAccountsParams(
  searchParams: { page?: string; q?: string; role?: string; schoolId?: string },
  pageSize: number = ACCOUNTS_PAGE_SIZE
): AccountsParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const size = pageSize > 0 ? pageSize : ACCOUNTS_PAGE_SIZE;
  const role = isUserRole(searchParams.role) ? searchParams.role : undefined;
  const schoolId = searchParams.schoolId?.trim() || undefined;
  return { page, pageSize: size, skip: (page - 1) * size, take: size, q, role, schoolId };
}

export function accountsTotalPages(
  totalCount: number,
  pageSize: number = ACCOUNTS_PAGE_SIZE
): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

/**
 * `deletedAt: null` unconditionally: `/admin/archive` already owns
 * soft-deleted accounts, and a console whose buttons reset passwords and mint
 * impersonation sessions must never offer either against a row that no longer
 * signs in.
 */
export function accountsWhere(params: {
  role?: UserRole;
  schoolId?: string;
  q?: string;
}): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    AND: [{ OR: [{ schoolId: null }, { school: { deletedAt: null } }] }],
  };
  if (params.role) where.role = params.role;
  if (params.schoolId) where.schoolId = params.schoolId;
  const q = params.q?.trim();
  if (q) {
    where.OR = [
      { fullName: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { username: { contains: q, mode: "insensitive" } },
      { school: { name: { contains: q, mode: "insensitive" } } },
      { school: { schoolIdCode: { contains: q, mode: "insensitive" } } },
    ];
  }
  return where;
}

type AccountsPageUser = {
  id: string;
  role: UserRole;
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string | null;
  schoolId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  approvalStatus: TeacherApprovalStatus | null;
  passwordIsSchoolId: boolean;
  passwordVaultCipher: string | null;
  school: { id: string; name: string; schoolIdCode: string } | null;
};

/**
 * The SCHOOL_HEAD-only branch is the entire reason a teacher row cannot carry
 * `sealed` or `school_id` — nothing outside this `if` produces them. Mirrors
 * the invariant `passwordChangeFields` already enforces on the write side (see
 * `src/lib/auth/password-vault.ts`).
 */
function accountPasswordState(user: AccountsPageUser): AccountPasswordState {
  if (user.role !== "SCHOOL_HEAD") return { kind: "never_stored" };
  if (user.passwordIsSchoolId) {
    return {
      kind: "school_id",
      value: defaultSchoolHeadPassword(user.school?.schoolIdCode ?? ""),
    };
  }
  if (user.passwordVaultCipher !== null) return { kind: "sealed" };
  return { kind: "not_recorded" };
}

function accountSignIn(user: AccountsPageUser): AccountSignIn {
  if (user.role === "SUPER_ADMIN") {
    return { kind: "username", value: user.username ?? user.email };
  }
  return { kind: "email", value: user.email, synthetic: isSyntheticEmail(user.email) };
}

/**
 * At most 3 Prisma calls, constant in row count:
 *  1. `user.findMany` with `relationLoadStrategy: "join"` — one SQL statement
 *     for the page of rows plus their joined `school`.
 *  2. `user.count` for the pager.
 *  3. one batch lookup for the oldest active School Head in each page school.
 * The page and count run inside one `Promise.all`; the final lookup is one
 * bounded query for the whole page. No per-row query, no per-row `await`
 * inside `.map()`, no per-row Supabase Admin call — the mapping below is pure.
 */
export async function getAccountsPage(
  params: AccountsParams
): Promise<{ rows: AccountRow[]; totalCount: number }> {
  const where = accountsWhere(params);

  const [users, totalCount] = await Promise.all([
    prisma.user.findMany({
      relationLoadStrategy: "join",
      where,
      orderBy: [
        { school: { name: "asc" } },
        { role: "asc" },
        { lastName: "asc" },
        { firstName: "asc" },
      ],
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        role: true,
        fullName: true,
        firstName: true,
        lastName: true,
        email: true,
        username: true,
        schoolId: true,
        isActive: true,
        mustChangePassword: true,
        approvalStatus: true,
        passwordIsSchoolId: true,
        // Selected only to be turned into a boolean/state below. Must never
        // reach the client component.
        passwordVaultCipher: true,
        school: { select: { id: true, name: true, schoolIdCode: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  const signInHeadIds = await findSignInSchoolHeadIds(
    users.flatMap((user) =>
      user.role === "SCHOOL_HEAD" && user.schoolId ? [user.schoolId] : []
    )
  );

  return {
    totalCount,
    rows: users.map((user) => ({
      id: user.id,
      role: user.role,
      fullName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
      schoolId: user.schoolId,
      school: user.school,
      signIn: accountSignIn(user),
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      approvalStatus: user.approvalStatus,
      password: accountPasswordState(user),
      signInHead: signInHeadIds.has(user.id),
      canRecoverByEmail: !isSyntheticEmail(user.email),
    })),
  };
}

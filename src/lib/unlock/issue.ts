import "server-only";
import type { Prisma, UnlockScope } from "@prisma/client";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { TEACHER_ROSTER_STATE, teacherRosterScope } from "@/lib/teachers/roster";
import { MAX_UNLOCK_DAYS } from "@/lib/validators/support.schema";

/**
 * The ONE place an `UnlockGrant` or a `SchoolUnlockGrant` row is written.
 *
 * Three callers issue grants — the support inbox resolving a ticket, the direct
 * grant, and the Super Admin unlock console — and before this module each of
 * them computed its own upsert. Three copies of an upsert on a natural key is
 * the kind of drift that ends with one path stacking a second row for a window
 * that already has one, at which point "is this window open?" starts depending
 * on which row a read happens to see first. The `@@unique` tuples make that
 * impossible in the database; this module makes it impossible to *ask* for.
 *
 * What lives here: the day clamp, the expiry arithmetic, the upsert, the audit
 * row and the bell. What does NOT live here:
 *
 * - **Authorization.** Every function takes an `actorId` and trusts it. The
 *   callers are server actions that have already established a Super Admin —
 *   see `src/lib/actions/unlock-admin.ts`, where that guard is explicit about
 *   why `requireUser(["SUPER_ADMIN"])` is not on its own enough.
 * - **The tenant boundary.** `schoolId` is a parameter, and it must be a value
 *   the caller READ FROM A DATABASE ROW (the target user's, the ticket's, the
 *   school's), never one that arrived in a payload. Passing a client-supplied
 *   `schoolId` here would write a grant against another tenant, which is the
 *   worst bug shippable in this app.
 * - **Revalidation.** Callers bust their own caches through
 *   `revalidateUnlockGrants` in `src/lib/cache/revalidate.ts`, because which
 *   surfaces went stale depends on who is looking, not on what was written.
 */

/** `prisma`, or a caller's transaction client. Same surface for the writes here. */
type UnlockWriteClient = Prisma.TransactionClient | typeof prisma;

/**
 * A grant lasts a whole number of days between 1 and the programme maximum.
 *
 * The schemas already enforce the range — `issueUnlockSchema` refuses 500
 * rather than quietly shortening it — so this is the floor under a caller that
 * is not a form: it keeps a bad internal number from becoming a grant that
 * never expires in practice, and it never widens anything the schema allowed.
 */
function clampDays(days: number): number {
  return Math.min(Math.max(Math.trunc(days), 1), MAX_UNLOCK_DAYS);
}

function expiryFrom(days: number): Date {
  return new Date(Date.now() + clampDays(days) * 24 * 60 * 60 * 1000);
}

export type IssuedTeacherUnlock = {
  id: string;
  expiresAt: Date;
  schoolId: string;
};

export type TeacherUnlockTarget = {
  id: string;
  schoolId: string;
};

/**
 * The teacher a grant may be issued to, or `null`.
 *
 * Soft-deleted accounts and accounts with no school are both excluded: the
 * first cannot sign in to use the access, and the second has no tenant for the
 * row to belong to. Callers take `schoolId` from what this returns — that is
 * the whole point of returning it rather than a boolean.
 *
 * Also `role: "TEACHER"` plus `TEACHER_ROSTER_STATE.active` — the same two
 * predicates `listUnlockTargets`' picker (`src/lib/unlock/admin-queries.ts`)
 * builds its list from. A grant issued to a School Head, or to a `PENDING`,
 * `REJECTED`, or deactivated teacher confers no actual access (every lock site
 * runs under `requireSchoolUser("TEACHER")`), so the write path must accept
 * exactly what the picker offers — never a wider set it then can't honor.
 *
 * Not a tenancy check. There is no tenant to check against: only a Super Admin
 * reaches these paths, and they are division-wide by definition.
 */
export async function findUnlockRecipient(
  userId: string
): Promise<TeacherUnlockTarget | null> {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deletedAt: null,
      schoolId: { not: null },
      role: "TEACHER",
      ...TEACHER_ROSTER_STATE.active,
    },
    select: { id: true, schoolId: true },
  });
  if (!user?.schoolId) return null;
  return { id: user.id, schoolId: user.schoolId };
}

/**
 * Open one window for one teacher.
 *
 * `schoolId` must come from the row the caller looked the teacher up in —
 * `findUnlockRecipient` above, the ticket being resolved. See the module note.
 *
 * `client` exists for `resolveTicket`, which closes the ticket and issues the
 * grant in one transaction: a grant whose ticket failed to close leaves an open
 * request against an already-open window, and a ticket closed as "granted" with
 * no grant tells a teacher they have access they do not have.
 *
 * `notifyRecipient` is false for that same caller, which already sends its own
 * "your request was answered" bell for this exact event. Two bells for one act
 * is noise, not redundancy.
 *
 * `audit` is false for that same caller too, for a reason specific to
 * `writeAudit`: it dispatches its insert through Next's `after()`, which is
 * registered the instant `writeAudit` is called — not once the surrounding
 * transaction commits. Calling it from inside `resolveTicket`'s
 * `$transaction` callback would queue the write before Postgres has agreed to
 * keep the grant, so a transaction that later fails to commit would still
 * leave an `UNLOCK_GRANT_ISSUE` row naming a grant id that was rolled back.
 * `resolveTicket` audits itself, after `$transaction` resolves, with the id
 * and expiry this function returns — see the note there.
 */
export async function issueTeacherUnlock(args: {
  actorId: string;
  userId: string;
  schoolId: string;
  scope: UnlockScope;
  targetKey: string;
  days: number;
  /** The ticket this grant answers, when it came from one. */
  ticketId?: string | null;
  client?: UnlockWriteClient;
  notifyRecipient?: boolean;
  /** False for a caller that will audit itself once its own transaction resolves. */
  audit?: boolean;
}): Promise<IssuedTeacherUnlock> {
  const {
    actorId,
    userId,
    schoolId,
    scope,
    targetKey,
    ticketId = null,
    client = prisma,
    notifyRecipient = true,
    audit = true,
  } = args;
  const expiresAt = expiryFrom(args.days);

  // Upsert on the natural key: a re-grant for the same window UPDATES this row
  // rather than stacking a second one, and clears any previous revocation —
  // otherwise the fresh expiry would sit on a row every read still treats as
  // revoked, which reads as granted and is not.
  const grant = await client.unlockGrant.upsert({
    where: { userId_scope_targetKey: { userId, scope, targetKey } },
    create: {
      schoolId,
      userId,
      scope,
      targetKey,
      grantedById: actorId,
      ticketId,
      expiresAt,
    },
    update: {
      grantedById: actorId,
      ...(ticketId ? { ticketId } : {}),
      expiresAt,
      revokedAt: null,
      revokedById: null,
    },
    select: { id: true },
  });

  if (audit) {
    await writeAudit({
      userId: actorId,
      schoolId,
      action: AUDIT_ACTIONS.UNLOCK_GRANT_ISSUE,
      resource: "UnlockGrant",
      resourceId: grant.id,
      // Ids, the window, and when it closes again. Never a name or an email:
      // `userId` is what an auditor resolves, and the audit viewers join for the
      // rest at read time.
      metadata: {
        ticketId,
        userId,
        scope,
        targetKey,
        expiresAt: expiresAt.toISOString(),
        direct: ticketId === null,
      },
    });
  }

  if (notifyRecipient) {
    await client.notification.create({
      data: {
        schoolId,
        recipientId: userId,
        actorId,
        type: "UNLOCK_GRANTED",
        learnerIds: [],
        unlockGrantId: grant.id,
      },
    });
  }

  return { id: grant.id, expiresAt, schoolId };
}

export type IssuedSchoolUnlock = {
  id: string;
  expiresAt: Date;
  /** Every teacher told about it — also who to revalidate for. */
  recipientIds: string[];
};

/**
 * Open one window for EVERY teacher in a school.
 *
 * One row, not one per teacher. A teacher hired after the grant is issued is
 * covered by it without a backfill, and revoking it closes the window for
 * everyone in a single write — both of which are the reason `SchoolUnlockGrant`
 * exists as its own table rather than as a fan-out of `UnlockGrant`.
 *
 * Recipients are the school's ACTIVE teachers, using the roster's own
 * definition of that state (`teacherRosterScope` + `TEACHER_ROSTER_STATE.active`
 * in `src/lib/teachers/roster.ts`) rather than a fresh predicate written here.
 * That module exists precisely because four copies of
 * `{ role: "TEACHER", deletedAt: null }` drifted; a fifth copy in the unlock
 * console would notify a set of people the teacher roster does not agree is
 * active. The recipient list only decides who gets a bell and whose caches are
 * busted — the grant itself covers the school, so nobody loses access by being
 * absent from it.
 */
export async function issueSchoolUnlock(args: {
  actorId: string;
  schoolId: string;
  scope: UnlockScope;
  targetKey: string;
  days: number;
}): Promise<IssuedSchoolUnlock> {
  const { actorId, schoolId, scope, targetKey } = args;
  const expiresAt = expiryFrom(args.days);

  const grant = await prisma.schoolUnlockGrant.upsert({
    where: { schoolId_scope_targetKey: { schoolId, scope, targetKey } },
    create: { schoolId, scope, targetKey, grantedById: actorId, expiresAt },
    update: {
      grantedById: actorId,
      expiresAt,
      revokedAt: null,
      revokedById: null,
    },
    select: { id: true },
  });

  const recipientIds = await activeTeacherIds(schoolId);

  await writeAudit({
    userId: actorId,
    schoolId,
    action: AUDIT_ACTIONS.UNLOCK_SCHOOL_GRANT_ISSUE,
    resource: "SchoolUnlockGrant",
    resourceId: grant.id,
    metadata: {
      scope,
      targetKey,
      expiresAt: expiresAt.toISOString(),
      recipients: recipientIds.length,
    },
  });

  if (recipientIds.length > 0) {
    await prisma.notification.createMany({
      data: recipientIds.map((recipientId) => ({
        schoolId,
        recipientId,
        actorId,
        type: "UNLOCK_GRANTED" as const,
        learnerIds: [],
        schoolUnlockGrantId: grant.id,
      })),
    });
  }

  return { id: grant.id, expiresAt, recipientIds };
}

/**
 * What a revoke did, without deciding how to say it.
 *
 * A discriminated result rather than a thrown `NOT_FOUND`, because the two
 * callers phrase a missing grant differently and both phrasings are load
 * bearing: the console answers in the `action()` shape, and `revokeUnlockGrant`
 * in `src/lib/actions/support.ts` must keep returning its exact legacy
 * `{ ok: false, error: "Not found" }`.
 */
export type RevokeOutcome =
  | {
      found: true;
      schoolId: string;
      /** Whose caches to bust. The grant holder, or the school's teachers. */
      recipientIds: string[];
      /** True when the grant was already revoked and nothing was written. */
      alreadyRevoked: boolean;
    }
  | { found: false };

/**
 * End one teacher's grant early.
 *
 * Sets `revokedAt` rather than deleting the row: "who could write into that
 * closed week, and until when" has to stay answerable afterwards. Idempotent —
 * revoking an already-revoked grant writes nothing and audits nothing, so a
 * double click cannot move the timestamp that records when access actually
 * ended.
 */
export async function revokeTeacherUnlock(args: {
  actorId: string;
  grantId: string;
}): Promise<RevokeOutcome> {
  const grant = await prisma.unlockGrant.findUnique({
    where: { id: args.grantId },
    select: {
      id: true,
      schoolId: true,
      userId: true,
      scope: true,
      targetKey: true,
      revokedAt: true,
    },
  });
  if (!grant) return { found: false };

  const outcome: RevokeOutcome = {
    found: true,
    schoolId: grant.schoolId,
    recipientIds: [grant.userId],
    alreadyRevoked: grant.revokedAt !== null,
  };
  if (grant.revokedAt) return outcome;

  await prisma.unlockGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date(), revokedById: args.actorId },
  });

  await writeAudit({
    userId: args.actorId,
    schoolId: grant.schoolId,
    action: AUDIT_ACTIONS.UNLOCK_GRANT_REVOKE,
    resource: "UnlockGrant",
    resourceId: grant.id,
    metadata: { userId: grant.userId, scope: grant.scope, targetKey: grant.targetKey },
  });

  return outcome;
}

/** The same act for a school-wide grant. Same idempotence, same reasoning. */
export async function revokeSchoolUnlock(args: {
  actorId: string;
  grantId: string;
}): Promise<RevokeOutcome> {
  const grant = await prisma.schoolUnlockGrant.findUnique({
    where: { id: args.grantId },
    select: {
      id: true,
      schoolId: true,
      scope: true,
      targetKey: true,
      revokedAt: true,
    },
  });
  if (!grant) return { found: false };

  const recipientIds = await activeTeacherIds(grant.schoolId);
  const outcome: RevokeOutcome = {
    found: true,
    schoolId: grant.schoolId,
    recipientIds,
    alreadyRevoked: grant.revokedAt !== null,
  };
  if (grant.revokedAt) return outcome;

  await prisma.schoolUnlockGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date(), revokedById: args.actorId },
  });

  await writeAudit({
    userId: args.actorId,
    schoolId: grant.schoolId,
    action: AUDIT_ACTIONS.UNLOCK_SCHOOL_GRANT_REVOKE,
    resource: "SchoolUnlockGrant",
    resourceId: grant.id,
    metadata: {
      scope: grant.scope,
      targetKey: grant.targetKey,
      recipients: recipientIds.length,
    },
  });

  return outcome;
}

/** The school's active teachers, by the roster's own definition of "active". */
async function activeTeacherIds(schoolId: string): Promise<string[]> {
  const teachers = await prisma.user.findMany({
    where: { ...teacherRosterScope(schoolId), ...TEACHER_ROSTER_STATE.active },
    select: { id: true },
  });
  return teachers.map((teacher) => teacher.id);
}

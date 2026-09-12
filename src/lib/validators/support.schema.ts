import { z } from "zod";
import { nonEmpty } from "./common";

/**
 * Support ticket and unlock grant input.
 *
 * Shared by the assistant's client form and the server actions, so the rules a
 * person is shown are the rules that are enforced. The server re-validates
 * regardless — the client half of this is a courtesy, not the gate.
 */

export const SUPPORT_TICKET_CATEGORIES = [
  "UNLOCK_REQUEST",
  "SYSTEM_ASSISTANCE",
  "BUG_REPORT",
  "ACCOUNT_ACCESS",
  "OTHER",
] as const;

export const UNLOCK_SCOPES = [
  "ARAL_WEEKLY_ATTENDANCE",
  "TERM_GRADES",
  "MONTHLY_READING_LEVEL",
] as const;

const TERM_PERIODS = ["FIRST", "SECOND", "THIRD"] as const;

/** Local `YYYY-MM-DD`, the key format `src/lib/date-keys.ts` produces. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A month anchor, `YYYY-MM-01`.
 *
 * Deliberately narrower than `DATE_KEY`, which would happily accept the 17th of
 * the month: `MONTHLY_READING_LEVEL` windows are keyed by the first of the month
 * at their lock site, so a grant for any other day of it would be a row nothing
 * ever reads.
 */
const MONTH_ANCHOR = /^\d{4}-\d{2}-01$/;

/**
 * Free text a person types about their problem. Capped so a paste of an entire
 * class list cannot land in the table, and trimmed so whitespace-only fails.
 */
const subject = nonEmpty("Tell us what you need in a few words").max(
  120,
  "Keep the subject under 120 characters"
);
const body = nonEmpty("Describe what you need").max(
  2000,
  "Keep the description under 2000 characters"
);

/**
 * The page the assistant was opened from.
 *
 * A pathname only — rejected if it carries a scheme, a host, or a query string.
 * That keeps an absolute URL (which could name another site) and a query string
 * (which could carry learner ids) out of a column that is shown to an admin.
 *
 * The `(?!\/)` is the host half of that promise: `//other.example.com` is a
 * protocol-relative URL, and every character in it is otherwise legal in a
 * pathname, so nothing but that lookahead tells the two apart.
 */
const pageUrl = z
  .string()
  .trim()
  .max(200)
  .regex(/^\/(?!\/)[A-Za-z0-9\-._~/]*$/, "Invalid page reference")
  .optional();

/**
 * An unlock target, validated against the scope that names it: a Monday-keyed
 * date for a week of attendance, a term name for a grade sheet.
 *
 * `superRefine` rather than a union so the error lands on the field the person
 * can actually fix, following the conditional-rule convention in the other
 * schemas here.
 */
const unlockTarget = z
  .object({
    scope: z.enum(UNLOCK_SCOPES),
    targetKey: nonEmpty("Choose which period to reopen"),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "ARAL_WEEKLY_ATTENDANCE" && !DATE_KEY.test(value.targetKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetKey"],
        message: "Choose a week",
      });
    }
    if (
      value.scope === "TERM_GRADES" &&
      !TERM_PERIODS.includes(value.targetKey as (typeof TERM_PERIODS)[number])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetKey"],
        message: "Choose a term",
      });
    }
    if (value.scope === "MONTHLY_READING_LEVEL" && !MONTH_ANCHOR.test(value.targetKey)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetKey"],
        message: "Choose a month",
      });
    }
  });

export const submitTicketSchema = z
  .object({
    category: z.enum(SUPPORT_TICKET_CATEGORIES),
    subject,
    body,
    pageUrl,
    requestedScope: z.enum(UNLOCK_SCOPES).optional(),
    requestedTargetKey: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.category !== "UNLOCK_REQUEST") {
      // Silently ignoring a stray scope on a non-unlock ticket would let a
      // request be resolved with a grant nobody asked for. Refuse instead.
      if (value.requestedScope || value.requestedTargetKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["requestedScope"],
          message: "Only an access request can name a period",
        });
      }
      return;
    }
    if (!value.requestedScope) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestedScope"],
        message: "Choose what you need reopened",
      });
      return;
    }
    const target = unlockTarget.safeParse({
      scope: value.requestedScope,
      targetKey: value.requestedTargetKey ?? "",
    });
    if (!target.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestedTargetKey"],
        message: target.error.errors[0]?.message ?? "Choose which period to reopen",
      });
    }
  });

export type SubmitTicketInput = z.infer<typeof submitTicketSchema>;

/**
 * Longest access an admin can hand out in one grant, and the default offered.
 *
 * ONE maximum for both paths that issue a grant — answering a ticket and the
 * unlock console. They are the same decision made by the same person about the
 * same table, and two constants for it would drift into "the console let me
 * pick 90, the ticket form refused it" with no rule to say which is right.
 *
 * Duration is a number of days, never an end date: expiry is always
 * `Date.now() + days * 86_400_000`, so a grant issued at 4pm runs out at 4pm,
 * not at whatever midnight a date picker would have implied.
 */
export const MAX_UNLOCK_DAYS = 90;
export const DEFAULT_UNLOCK_DAYS = 7;

export const resolveTicketSchema = z.object({
  ticketId: nonEmpty("Ticket is required").uuid("Ticket is required"),
  /** Shown verbatim to the requester as the single reply on the ticket. */
  note: z.string().trim().max(1000, "Keep the note under 1000 characters").optional(),
  /**
   * Present only when the admin is answering an unlock request by granting it.
   * Its absence resolves the ticket without changing anyone's access.
   */
  grant: z
    .object({
      days: z
        .number()
        .int("Choose a whole number of days")
        .min(1, "Access must last at least a day")
        .max(MAX_UNLOCK_DAYS, `Access cannot last more than ${MAX_UNLOCK_DAYS} days`),
    })
    .optional(),
});

export type ResolveTicketInput = z.infer<typeof resolveTicketSchema>;

export const declineTicketSchema = z.object({
  ticketId: nonEmpty("Ticket is required").uuid("Ticket is required"),
  note: nonEmpty("Say why, so the requester knows what to do next").max(
    1000,
    "Keep the note under 1000 characters"
  ),
});

export const revokeGrantSchema = z.object({
  grantId: nonEmpty("Grant is required").uuid("Grant is required"),
});

/**
 * A uuid a form may also send as `""` when the picker it belongs to is not the
 * one in play. The empty string becomes "absent" so the `superRefine` below can
 * speak about presence, rather than every mode failing a `uuid()` on the field
 * it deliberately left blank.
 */
const optionalId = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().uuid("Choose a valid option").optional()
);

/**
 * The unlock console's issue form: one grant, to one teacher or to a whole
 * school.
 *
 * `mode` decides which id is required and, just as deliberately, which id is
 * refused. A payload carrying both would leave the action choosing between two
 * targets, and "which one wins" is not a question an access grant should have.
 *
 * `days` is coerced because this arrives from a number input as a string, and
 * the maximum is the schema's job rather than the action's: an action that
 * clamped 500 down to 90 would hand out three months of access to somebody who
 * asked for sixteen and never learn they had mistyped.
 */
export const issueUnlockSchema = z
  .object({
    mode: z.enum(["teacher", "school"]),
    userId: optionalId,
    schoolId: optionalId,
    scope: z.enum(UNLOCK_SCOPES),
    targetKey: nonEmpty("Choose which period to reopen"),
    days: z.coerce
      .number()
      .int("Choose a whole number of days")
      .min(1, "Access must last at least a day")
      .max(MAX_UNLOCK_DAYS, `Access cannot last more than ${MAX_UNLOCK_DAYS} days`),
    reason: z.string().trim().max(500, "Keep the reason under 500 characters").optional(),
  })
  .superRefine((value, ctx) => {
    const required = value.mode === "teacher" ? "userId" : "schoolId";
    const unused = value.mode === "teacher" ? "schoolId" : "userId";
    if (!value[required]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [required],
        message: value.mode === "teacher" ? "Choose a teacher" : "Choose a school",
      });
    }
    if (value[unused]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [unused],
        message: "Choose either one teacher or one school, not both",
      });
    }

    const target = unlockTarget.safeParse({
      scope: value.scope,
      targetKey: value.targetKey,
    });
    if (!target.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetKey"],
        message: target.error.errors[0]?.message ?? "Choose which period to reopen",
      });
    }
  });

export type IssueUnlockInput = z.infer<typeof issueUnlockSchema>;

/**
 * Revoking from the console. `kind` says which table the id is in — the two
 * grant tables have independent uuid spaces, so without it a revoke would have
 * to probe both and could only report "not found" after two round trips.
 */
export const revokeUnlockSchema = z.object({
  kind: z.enum(["teacher", "school"]),
  grantId: nonEmpty("Grant is required").uuid("Grant is required"),
});

export type RevokeUnlockInput = z.infer<typeof revokeUnlockSchema>;

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

export const UNLOCK_SCOPES = ["ARAL_WEEKLY_ATTENDANCE", "TERM_GRADES"] as const;

const TERM_PERIODS = ["FIRST", "SECOND", "THIRD"] as const;

/** Local `YYYY-MM-DD`, the key format `src/lib/date-keys.ts` produces. */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

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

/** Longest access an admin can hand out in one grant, and the default offered. */
export const MAX_UNLOCK_DAYS = 30;
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

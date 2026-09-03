import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNLOCK_DAYS,
  MAX_UNLOCK_DAYS,
  declineTicketSchema,
  resolveTicketSchema,
  revokeGrantSchema,
  submitTicketSchema,
} from "@/lib/validators/support.schema";

/**
 * The support schemas, and specifically the rules that are not obvious from the
 * field list.
 *
 * Two of them are load-bearing beyond input hygiene:
 *
 * - **A stray scope on a non-unlock ticket is refused, not dropped.** If it were
 *   dropped, a "Bug report" could carry `requestedScope` through to an admin who
 *   answers it with a grant nobody asked for. The refusal is the reason
 *   `resolveTicket` can trust that a ticket naming a period is an access request.
 * - **`pageUrl` is a bare pathname.** It is displayed in the admin inbox, so an
 *   absolute URL would let a requester put another site's address on an admin's
 *   screen, and a query string would let learner ids ride along into a column
 *   that is meant to say only which page somebody was on.
 */

const VALID_ID = "3f0c2f9c-6d1e-4b6f-9a2a-8f4e7c1b5d90";

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    category: "SYSTEM_ASSISTANCE",
    subject: "Cannot open the weekly grid",
    body: "The grid shows read only and I still have three learners to mark.",
    ...overrides,
  };
}

describe("submitTicketSchema", () => {
  it("accepts a plain assistance request with no period", () => {
    const parsed = submitTicketSchema.safeParse(ticket());
    expect(parsed.success).toBe(true);
  });

  it("accepts an unlock request naming a week", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({
        category: "UNLOCK_REQUEST",
        requestedScope: "ARAL_WEEKLY_ATTENDANCE",
        requestedTargetKey: "2026-08-31",
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("accepts an unlock request naming a term", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({
        category: "UNLOCK_REQUEST",
        requestedScope: "TERM_GRADES",
        requestedTargetKey: "SECOND",
      })
    );
    expect(parsed.success).toBe(true);
  });

  it("refuses a period on a category that cannot carry one", () => {
    // Not dropped — refused. See the module note: dropping it would let a bug
    // report be answered with a grant.
    const parsed = submitTicketSchema.safeParse(
      ticket({
        category: "BUG_REPORT",
        requestedScope: "TERM_GRADES",
        requestedTargetKey: "FIRST",
      })
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.errors[0]?.message).toBe(
      "Only an access request can name a period"
    );
  });

  it("refuses a stray target key even with no scope", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({ category: "OTHER", requestedTargetKey: "2026-08-31" })
    );
    expect(parsed.success).toBe(false);
  });

  it("requires a scope on an unlock request", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({ category: "UNLOCK_REQUEST" })
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.errors[0]?.message).toBe("Choose what you need reopened");
  });

  it("requires a date key for a week, not a term name", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({
        category: "UNLOCK_REQUEST",
        requestedScope: "ARAL_WEEKLY_ATTENDANCE",
        requestedTargetKey: "FIRST",
      })
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.errors[0]?.message).toBe("Choose a week");
    expect(parsed.error.errors[0]?.path).toEqual(["requestedTargetKey"]);
  });

  it("requires a term name for grades, not a date key", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({
        category: "UNLOCK_REQUEST",
        requestedScope: "TERM_GRADES",
        requestedTargetKey: "2026-08-31",
      })
    );
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.errors[0]?.message).toBe("Choose a term");
  });

  it("refuses an unlock request with no period at all", () => {
    const parsed = submitTicketSchema.safeParse(
      ticket({
        category: "UNLOCK_REQUEST",
        requestedScope: "ARAL_WEEKLY_ATTENDANCE",
        requestedTargetKey: "",
      })
    );
    expect(parsed.success).toBe(false);
  });

  it("refuses a made-up category", () => {
    expect(submitTicketSchema.safeParse(ticket({ category: "URGENT" })).success).toBe(
      false
    );
  });

  it("refuses whitespace-only text", () => {
    expect(submitTicketSchema.safeParse(ticket({ subject: "   " })).success).toBe(
      false
    );
    expect(submitTicketSchema.safeParse(ticket({ body: "\n\t " })).success).toBe(
      false
    );
  });

  it("caps the subject and the body", () => {
    expect(
      submitTicketSchema.safeParse(ticket({ subject: "x".repeat(121) })).success
    ).toBe(false);
    expect(
      submitTicketSchema.safeParse(ticket({ body: "x".repeat(2001) })).success
    ).toBe(false);
    expect(
      submitTicketSchema.safeParse(ticket({ body: "x".repeat(2000) })).success
    ).toBe(true);
  });

  describe("pageUrl", () => {
    it("accepts an in-app pathname", () => {
      const parsed = submitTicketSchema.safeParse(
        ticket({ pageUrl: "/teacher/aral/grade-7" })
      );
      expect(parsed.success).toBe(true);
    });

    it("accepts being left out", () => {
      expect(submitTicketSchema.safeParse(ticket()).success).toBe(true);
    });

    for (const bad of [
      "https://example.com/teacher",
      "//evil.example.com",
      "/teacher/aral?learnerId=abc",
      "/teacher/aral#top",
      "teacher/aral",
      "javascript:alert(1)",
      "/teacher/aral learners",
    ]) {
      it(`refuses ${JSON.stringify(bad)}`, () => {
        const parsed = submitTicketSchema.safeParse(ticket({ pageUrl: bad }));
        expect(parsed.success).toBe(false);
      });
    }
  });
});

describe("resolveTicketSchema", () => {
  it("accepts an id alone — resolving without granting anything", () => {
    const parsed = resolveTicketSchema.safeParse({ ticketId: VALID_ID });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.grant).toBeUndefined();
  });

  it("accepts a grant inside the allowed range", () => {
    for (const days of [1, DEFAULT_UNLOCK_DAYS, MAX_UNLOCK_DAYS]) {
      const parsed = resolveTicketSchema.safeParse({
        ticketId: VALID_ID,
        grant: { days },
      });
      expect(parsed.success, `days=${days}`).toBe(true);
    }
  });

  it("refuses a grant that never expires in practice", () => {
    // The cap is the reason a grant is temporary rather than a permanent
    // widening of what a teacher can edit.
    const parsed = resolveTicketSchema.safeParse({
      ticketId: VALID_ID,
      grant: { days: MAX_UNLOCK_DAYS + 1 },
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.errors[0]?.message).toBe(
      `Access cannot last more than ${MAX_UNLOCK_DAYS} days`
    );
  });

  it("refuses zero, negative, and fractional days", () => {
    for (const days of [0, -1, 1.5]) {
      expect(
        resolveTicketSchema.safeParse({ ticketId: VALID_ID, grant: { days } }).success,
        `days=${days}`
      ).toBe(false);
    }
  });

  it("refuses an id that is not a uuid", () => {
    expect(resolveTicketSchema.safeParse({ ticketId: "42" }).success).toBe(false);
    expect(resolveTicketSchema.safeParse({ ticketId: "" }).success).toBe(false);
  });

  it("caps the reply note", () => {
    expect(
      resolveTicketSchema.safeParse({ ticketId: VALID_ID, note: "x".repeat(1001) })
        .success
    ).toBe(false);
  });
});

describe("declineTicketSchema", () => {
  it("requires a reason", () => {
    // A decline with no note leaves somebody blocked and told nothing, so the
    // note is mandatory here where it is optional on a resolve.
    const parsed = declineTicketSchema.safeParse({ ticketId: VALID_ID, note: "  " });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.errors[0]?.message).toBe(
      "Say why, so the requester knows what to do next"
    );
  });

  it("accepts a reason", () => {
    const parsed = declineTicketSchema.safeParse({
      ticketId: VALID_ID,
      note: "The term is already submitted to the division office.",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("revokeGrantSchema", () => {
  it("accepts a uuid and refuses anything else", () => {
    expect(revokeGrantSchema.safeParse({ grantId: VALID_ID }).success).toBe(true);
    expect(revokeGrantSchema.safeParse({ grantId: "" }).success).toBe(false);
    expect(revokeGrantSchema.safeParse({ grantId: "all" }).success).toBe(false);
  });
});

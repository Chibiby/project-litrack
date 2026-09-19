import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Hiding the demo schools from the login dropdown is not enough on its own: the
 * school id travels in the sign-in form, so a copied id or a crafted request
 * would still reach the training tenant. `requireActiveSchool` is the single
 * choke point every sign-in and self-registration path goes through, which
 * makes these the tests that decide whether "admins only" is real.
 */

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { school: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

const isDemoVisible = vi.fn(async () => false);
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: () => isDemoVisible() }));

const REAL = { id: "school-1", isActive: true, deletedAt: null, isDemo: false };
const DEMO = { id: "school-demo", isActive: true, deletedAt: null, isDemo: true };

async function requireActiveSchool(id: string) {
  const { requireActiveSchool: gate } = await import("@/lib/auth/login-gates");
  return gate(id);
}

beforeEach(() => {
  findUnique.mockReset();
  isDemoVisible.mockReset();
  isDemoVisible.mockResolvedValue(false);
});

describe("requireActiveSchool and the demo tenant", () => {
  it("admits a real school with no demo session in sight", async () => {
    findUnique.mockResolvedValue(REAL);

    await expect(requireActiveSchool(REAL.id)).resolves.toEqual({ id: REAL.id });
  });

  it("refuses a demo school outside a demo session", async () => {
    findUnique.mockResolvedValue(DEMO);

    await expect(requireActiveSchool(DEMO.id)).rejects.toThrow();
  });

  it("answers exactly as it does for a school that is not there", async () => {
    // The wording matters: a distinct message would tell an outsider that a
    // hidden school exists and can be unlocked somehow.
    findUnique.mockResolvedValue(DEMO);
    const hidden = await requireActiveSchool(DEMO.id).catch((e: Error) => e);
    findUnique.mockResolvedValue(null);
    const missing = await requireActiveSchool("nope").catch((e: Error) => e);

    expect((hidden as Error).message).toBe((missing as Error).message);
  });

  it("admits the demo school once a demo session is open", async () => {
    findUnique.mockResolvedValue(DEMO);
    isDemoVisible.mockResolvedValue(true);

    await expect(requireActiveSchool(DEMO.id)).resolves.toEqual({ id: DEMO.id });
  });

  it("still refuses a deactivated demo school inside a demo session", async () => {
    findUnique.mockResolvedValue({ ...DEMO, isActive: false });
    isDemoVisible.mockResolvedValue(true);

    await expect(requireActiveSchool(DEMO.id)).rejects.toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { listKey } from "@/lib/nav/list-params";

/**
 * `/school-head/audit` wraps `SchoolAuditTable` in a `<Suspense key={...}>`
 * keyed by `listKey(searchParams, AUDIT_LIST_KEYS)` — every param
 * `parseAuditListParams` reads (page, q, from, to), excluding the Super
 * Admin's `?schoolId=` view-context param.
 */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    user: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("@/lib/school-head/view", () => ({
  resolveSchoolHeadView: vi.fn(async () => ({
    user: { id: "head-1" },
    view: { schoolId: "school-1", schoolName: null, isSuperAdminView: false },
  })),
}));

const { default: SchoolAuditPage, AUDIT_LIST_KEYS } = await import(
  "@/app/school-head/(app)/audit/page"
);

/** Walk the page's returned tree to the keyed `Suspense` element. */
function suspenseElementOf(pageElement: ReactElement): ReactElement {
  return (pageElement.props as { children: ReactElement }).children;
}

describe("School Head audit page — Suspense boundary key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(AUDIT_LIST_KEYS).toEqual(["page", "q", "from", "to"]);
  });

  it("changes when a list-affecting param (q) changes", async () => {
    const before = suspenseElementOf(
      await SchoolAuditPage({ searchParams: Promise.resolve({ q: "cruz" }) })
    );
    const after = suspenseElementOf(
      await SchoolAuditPage({ searchParams: Promise.resolve({ q: "santos" }) })
    );

    expect(before.key).not.toBe(after.key);
    expect(before.key).toBe(listKey({ q: "cruz" }, AUDIT_LIST_KEYS));
  });

  it("changes when page, from, or to change", async () => {
    const base = suspenseElementOf(
      await SchoolAuditPage({ searchParams: Promise.resolve({}) })
    );
    const byPage = suspenseElementOf(
      await SchoolAuditPage({ searchParams: Promise.resolve({ page: "2" }) })
    );
    const byFrom = suspenseElementOf(
      await SchoolAuditPage({ searchParams: Promise.resolve({ from: "2026-06-01" }) })
    );
    const byTo = suspenseElementOf(
      await SchoolAuditPage({ searchParams: Promise.resolve({ to: "2026-06-30" }) })
    );

    expect(byPage.key).not.toBe(base.key);
    expect(byFrom.key).not.toBe(base.key);
    expect(byTo.key).not.toBe(base.key);
  });

  it("does NOT change when the Super Admin view's schoolId changes", async () => {
    expect(AUDIT_LIST_KEYS).not.toContain("schoolId");

    const before = suspenseElementOf(
      await SchoolAuditPage({
        searchParams: Promise.resolve({ q: "cruz", schoolId: "school-1" }),
      })
    );
    const after = suspenseElementOf(
      await SchoolAuditPage({
        searchParams: Promise.resolve({ q: "cruz", schoolId: "school-2" }),
      })
    );

    expect(before.key).toBe(after.key);
  });
});

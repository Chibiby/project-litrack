import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { listKey } from "@/lib/nav/list-params";

/**
 * Proves the ARAL learners rows Suspense boundary in `/teacher/aral` is keyed
 * on exactly the params that change which rows are shown (page, grade,
 * section) and not on the Super Admin's `?schoolId=` view-context param.
 * Without a matching key the boundary keeps stale rows on screen instead of
 * swapping to the fallback skeleton on a same-route param change.
 *
 * Walks the returned React element tree rather than rendering to the DOM —
 * mirrors `tests/unit/learners/roster-suspense-key.test.tsx`.
 */

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn().mockResolvedValue({
    id: "admin-1",
    role: "SUPER_ADMIN",
    schoolId: "school-1",
    profileCompleted: true,
    fullName: "Admin Person",
    firstName: "Admin",
    lastName: "Person",
  }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    gradeLevel: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock("@/lib/dashboard/aggregates", () => ({
  getTeacherShellGrades: vi.fn().mockResolvedValue([{ id: "grade-1", type: "G3" }]),
}));
vi.mock("@/lib/cache/grade-sections", () => ({
  getGradeSections: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/teachers/aral-tutor", () => ({
  listAralTutors: vi.fn().mockResolvedValue([]),
}));

const { default: AralDashboard, ARAL_LEARNERS_LIST_KEYS } = await import(
  "@/app/teacher/(app)/aral/page"
);

/** Depth-first search for the Suspense element wrapping `AralLearnersTable`. */
function findRowsSuspense(node: unknown): { key: React.Key | null } | undefined {
  if (node === null || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findRowsSuspense(child);
      if (found) return found;
    }
    return undefined;
  }
  const el = node as {
    type?: unknown;
    key?: React.Key | null;
    props?: { children?: unknown };
  };
  if (el.type === Suspense) {
    const child = el.props?.children as { type?: { name?: string } } | undefined;
    if (child?.type?.name === "AralLearnersTable") {
      return { key: el.key ?? null };
    }
  }
  if (el.props?.children !== undefined) {
    return findRowsSuspense(el.props.children);
  }
  return undefined;
}

async function suspenseKeyFor(searchParams: Record<string, string | undefined>) {
  const ui = await AralDashboard({ searchParams: Promise.resolve(searchParams) });
  const found = findRowsSuspense(ui);
  if (!found) throw new Error("rows Suspense boundary not found in the page tree");
  return found.key;
}

describe("ARAL learners page — rows Suspense key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(ARAL_LEARNERS_LIST_KEYS).toEqual(["page", "grade", "section"]);
  });

  it("matches listKey() over the row-affecting params", async () => {
    const sp = { grade: "grade-1" };
    const key = await suspenseKeyFor(sp);
    expect(key).toBe(listKey(sp, ARAL_LEARNERS_LIST_KEYS));
  });

  it("changes when page, grade, or section change", async () => {
    const base = await suspenseKeyFor({});
    expect(await suspenseKeyFor({ page: "2" })).not.toBe(base);
    expect(await suspenseKeyFor({ grade: "grade-1" })).not.toBe(base);
    expect(await suspenseKeyFor({ section: "sec-1" })).not.toBe(base);
  });

  it("does NOT change for an unrelated param, e.g. the admin ?schoolId= view context", async () => {
    const base = await suspenseKeyFor({});
    expect(await suspenseKeyFor({ schoolId: "school-2" })).toBe(base);
  });
});

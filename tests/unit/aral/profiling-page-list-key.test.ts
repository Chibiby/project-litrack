import { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { listKey } from "@/lib/nav/list-params";

/**
 * Proves the ARAL Profiling rows Suspense boundary is keyed on exactly the
 * params that change which rows are shown (page, status, q, section) and not
 * on the Super Admin's `?schoolId=` view-context param. The page previously
 * built this key by hand from derived values — this locks it to `listKey`
 * over the raw search params instead.
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
    aralProfile: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock("@/lib/cache/grade-sections", () => ({
  getGradeSections: vi.fn().mockResolvedValue([]),
}));

const { default: AralProfilingPage, PROFILING_LIST_KEYS } = await import(
  "@/app/teacher/(app)/aral/profiling/page"
);

/** Depth-first search for the Suspense element wrapping `ProfilingRows`. */
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
    if (child?.type?.name === "ProfilingRows") {
      return { key: el.key ?? null };
    }
  }
  if (el.props?.children !== undefined) {
    return findRowsSuspense(el.props.children);
  }
  return undefined;
}

async function suspenseKeyFor(searchParams: Record<string, string | undefined>) {
  const ui = await AralProfilingPage({ searchParams: Promise.resolve(searchParams) });
  const found = findRowsSuspense(ui);
  if (!found) throw new Error("rows Suspense boundary not found in the page tree");
  return found.key;
}

describe("ARAL Profiling page — rows Suspense key", () => {
  it("declares exactly the list-affecting params", () => {
    expect(PROFILING_LIST_KEYS).toEqual(["page", "status", "q", "section"]);
  });

  it("matches listKey() over the row-affecting params", async () => {
    const sp = { status: "pending", q: "ana" };
    const key = await suspenseKeyFor(sp);
    expect(key).toBe(listKey(sp, PROFILING_LIST_KEYS));
  });

  it("changes when page, status, q, or section change", async () => {
    const base = await suspenseKeyFor({});
    expect(await suspenseKeyFor({ page: "2" })).not.toBe(base);
    expect(await suspenseKeyFor({ status: "completed" })).not.toBe(base);
    expect(await suspenseKeyFor({ q: "ana" })).not.toBe(base);
    expect(await suspenseKeyFor({ section: "sec-1" })).not.toBe(base);
  });

  it("does NOT change for an unrelated param, e.g. the admin ?schoolId= view context", async () => {
    const base = await suspenseKeyFor({});
    expect(await suspenseKeyFor({ schoolId: "school-2" })).toBe(base);
  });
});

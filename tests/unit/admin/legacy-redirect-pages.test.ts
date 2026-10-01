import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pre-restructure Super Admin URLs (`/admin/schools`, `/admin/accounts`, …)
 * are now stub pages that only `redirect()`. Bookmarks, printed docs and
 * already-delivered chat notifications still point at them, so each stub must
 * land on the right new page with its query string intact.
 *
 * `redirect` is replaced with a thrower, like Next's own NEXT_REDIRECT, so the
 * page function stops where the real one would.
 */

class Redirected extends Error {
  constructor(public readonly to: string) {
    super(`redirect:${to}`);
  }
}
const redirect = vi.fn((to: string) => {
  throw new Redirected(to);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

type Search = Record<string, string | string[] | undefined>;

async function landed(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    if (err instanceof Redirected) return err.to;
    throw err;
  }
  throw new Error("page returned without redirecting");
}

const { default: LegacyAccounts } = await import("@/app/admin/accounts/page");
const { default: LegacySchoolAccounts } = await import("@/app/admin/school-accounts/page");
const { default: LegacySchools } = await import("@/app/admin/schools/page");
const { default: LegacySchoolDetail } = await import("@/app/admin/schools/[schoolId]/page");
const { default: LegacyNewSchool } = await import("@/app/admin/schools/new/page");
const { default: LegacySummary } = await import("@/app/admin/summary/page");
const { default: LegacySummaryFacet } = await import("@/app/admin/summary/[facet]/page");
const { default: LegacyIpLearners } = await import("@/app/admin/ip-learners/page");
const { default: LegacySchoolYears } = await import("@/app/admin/school-years/page");
const { default: LegacyTermSubjects } = await import("@/app/admin/term-subjects/page");
const { default: LegacySubmissions } = await import("@/app/admin/submissions/page");
const { default: LegacySubmissionSettings } = await import("@/app/admin/settings/submissions/page");
const { default: LegacyTransfers } = await import("@/app/admin/transfers/page");
const { default: LegacySupport } = await import("@/app/admin/support/page");

beforeEach(() => {
  redirect.mockClear();
});

describe("/admin/accounts", () => {
  const go = (searchParams: Search) =>
    landed(() => LegacyAccounts({ searchParams: Promise.resolve(searchParams) }));

  it("sends ?role=SCHOOL_HEAD to School Heads and drops role but keeps the rest", async () => {
    expect(await go({ role: "SCHOOL_HEAD", q: "x" })).toBe("/admin/management/school-heads?q=x");
  });

  it("sends ?role=DISTRICT_ADMIN to District Admins", async () => {
    expect(await go({ role: "DISTRICT_ADMIN", district: "Alamada" })).toBe(
      "/admin/management/district-admins?district=Alamada"
    );
  });

  it("sends ?role=TEACHER, no role, or an unknown role to Teachers", async () => {
    expect(await go({ role: "TEACHER", grade: "G3" })).toBe("/admin/management/teachers?grade=G3");
    expect(await go({})).toBe("/admin/management/teachers");
    expect(await go({ role: "nonsense", page: "2" })).toBe("/admin/management/teachers?page=2");
  });

  it("carries school, sort and page across", async () => {
    expect(await go({ role: "SCHOOL_HEAD", schoolId: "s1", sort: "school", page: "3" })).toBe(
      "/admin/management/school-heads?schoolId=s1&sort=school&page=3"
    );
  });
});

describe("/admin/school-accounts", () => {
  it("lands on School Heads and drops a stale role param", async () => {
    expect(
      await landed(() =>
        LegacySchoolAccounts({ searchParams: Promise.resolve({ role: "SCHOOL_HEAD", q: "naidas" }) })
      )
    ).toBe("/admin/management/school-heads?q=naidas");
  });
});

describe("/admin/schools", () => {
  it("keeps a saved filter on the list", async () => {
    expect(
      await landed(() =>
        LegacySchools({ searchParams: Promise.resolve({ status: "inactive", region: "Region XII" }) })
      )
    ).toBe("/admin/management/schools?status=inactive&region=Region+XII");
  });

  it("redirects a school detail to the nested path with its tab and filters", async () => {
    expect(
      await landed(() =>
        LegacySchoolDetail({
          params: Promise.resolve({ schoolId: "sch-123" }),
          searchParams: Promise.resolve({ tab: "teachers", learnersSort: "alphabetical" }),
        })
      )
    ).toBe("/admin/management/schools/sch-123?tab=teachers&learnersSort=alphabetical");
  });

  it("encodes a hostile school id rather than letting it change the path", async () => {
    const to = await landed(() =>
      LegacySchoolDetail({
        params: Promise.resolve({ schoolId: "../../audit?x=1#" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(to).toBe("/admin/management/schools/..%2F..%2Faudit%3Fx%3D1%23");
    expect(to.startsWith("/admin/management/schools/")).toBe(true);
  });

  it("redirects /admin/schools/new", async () => {
    expect(await landed(() => LegacyNewSchool({ searchParams: Promise.resolve({}) }))).toBe(
      "/admin/management/schools/new"
    );
  });
});

describe("/admin/summary", () => {
  it("redirects the summary root", async () => {
    expect(await landed(() => LegacySummary({ searchParams: Promise.resolve({}) }))).toBe(
      "/admin/monitoring/division-summary"
    );
  });

  it("redirects a facet and keeps level/district/month filters", async () => {
    expect(
      await landed(() =>
        LegacySummaryFacet({
          params: Promise.resolve({ facet: "learners" }),
          searchParams: Promise.resolve({ level: "school", district: "Alamada", month: "2026-09" }),
        })
      )
    ).toBe("/admin/monitoring/division-summary/learners?level=school&district=Alamada&month=2026-09");
  });

  it("encodes a hostile facet segment", async () => {
    const to = await landed(() =>
      LegacySummaryFacet({
        params: Promise.resolve({ facet: "a/b" }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(to).toBe("/admin/monitoring/division-summary/a%2Fb");
  });
});

describe("the other moved pages", () => {
  const cases: Array<[string, (p: { searchParams: Promise<Search> }) => Promise<unknown>, Search, string]> = [
    ["/admin/ip-learners", LegacyIpLearners, { ip: "yes", page: "2" }, "/admin/management/learners?ip=yes&page=2"],
    ["/admin/school-years", LegacySchoolYears, {}, "/admin/school-setup/school-years"],
    ["/admin/term-subjects", LegacyTermSubjects, { type: "G1" }, "/admin/school-setup/term-subjects?type=G1"],
    [
      "/admin/submissions",
      LegacySubmissions,
      { schoolId: "s1", schoolYearId: "y1" },
      "/admin/school-setup/report-submissions?schoolId=s1&schoolYearId=y1",
    ],
    [
      "/admin/settings/submissions",
      LegacySubmissionSettings,
      {},
      "/admin/school-setup/report-submissions",
    ],
    ["/admin/transfers", LegacyTransfers, { q: "cruz" }, "/admin/school-setup/learner-transfers?q=cruz"],
    [
      "/admin/support",
      LegacySupport,
      { tab: "chat", channel: "c1" },
      "/admin/monitoring/support?tab=chat&channel=c1",
    ],
  ];

  it.each(cases)("%s", async (_legacy, page, search, expected) => {
    expect(await landed(() => page({ searchParams: Promise.resolve(search) }))).toBe(expected);
  });

  it("keeps repeated query keys", async () => {
    expect(
      await landed(() => LegacyTransfers({ searchParams: Promise.resolve({ status: ["a", "b"] }) }))
    ).toBe("/admin/school-setup/learner-transfers?status=a&status=b");
  });
});

describe("every stub", () => {
  it("redirects exactly once and never to a legacy path (no redirect loop)", async () => {
    const pages: Array<() => Promise<unknown>> = [
      () => LegacyAccounts({ searchParams: Promise.resolve({}) }),
      () => LegacySchoolAccounts({ searchParams: Promise.resolve({}) }),
      () => LegacySchools({ searchParams: Promise.resolve({}) }),
      () => LegacyNewSchool({ searchParams: Promise.resolve({}) }),
      () => LegacySummary({ searchParams: Promise.resolve({}) }),
      () => LegacyIpLearners({ searchParams: Promise.resolve({}) }),
      () => LegacySchoolYears({ searchParams: Promise.resolve({}) }),
      () => LegacyTermSubjects({ searchParams: Promise.resolve({}) }),
      () => LegacySubmissions({ searchParams: Promise.resolve({}) }),
      () => LegacySubmissionSettings({ searchParams: Promise.resolve({}) }),
      () => LegacyTransfers({ searchParams: Promise.resolve({}) }),
      () => LegacySupport({ searchParams: Promise.resolve({}) }),
    ];
    const legacy = [
      "/admin/accounts",
      "/admin/school-accounts",
      "/admin/schools",
      "/admin/ip-learners",
      "/admin/school-years",
      "/admin/term-subjects",
      "/admin/submissions",
      "/admin/settings/submissions",
      "/admin/transfers",
      "/admin/summary",
      "/admin/support",
    ];
    for (const run of pages) {
      redirect.mockClear();
      const to = await landed(run);
      expect(redirect).toHaveBeenCalledTimes(1);
      const path = to.split("?")[0];
      expect(legacy).not.toContain(path);
      expect(path.startsWith("/admin/")).toBe(true);
    }
  });
});

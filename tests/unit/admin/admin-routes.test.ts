import { describe, expect, it } from "vitest";
import {
  ADMIN_ROUTES,
  LEGACY_ADMIN_REDIRECTS,
  accountsRoleRoute,
  withSearchParams,
} from "@/lib/routes/admin";

/**
 * `src/lib/routes/admin.ts` — the Super Admin route table the sidebar,
 * `revalidatePath` calls and the legacy redirect pages all read from.
 */

describe("ADMIN_ROUTES", () => {
  it("nests each page under the sidebar section it appears in", () => {
    expect(ADMIN_ROUTES.learners).toBe("/admin/management/learners");
    expect(ADMIN_ROUTES.teachers).toBe("/admin/management/teachers");
    expect(ADMIN_ROUTES.schoolHeads).toBe("/admin/management/school-heads");
    expect(ADMIN_ROUTES.schools).toBe("/admin/management/schools");
    expect(ADMIN_ROUTES.districtAdmins).toBe("/admin/management/district-admins");
    expect(ADMIN_ROUTES.schoolYears).toBe("/admin/school-setup/school-years");
    expect(ADMIN_ROUTES.termSubjects).toBe("/admin/school-setup/term-subjects");
    expect(ADMIN_ROUTES.reportSubmissions).toBe("/admin/school-setup/report-submissions");
    expect(ADMIN_ROUTES.learnerTransfers).toBe("/admin/school-setup/learner-transfers");
    expect(ADMIN_ROUTES.divisionSummary).toBe("/admin/monitoring/division-summary");
    expect(ADMIN_ROUTES.support).toBe("/admin/monitoring/support");
  });

  it("builds the school and summary-facet detail paths", () => {
    expect(ADMIN_ROUTES.school("abc-123")).toBe("/admin/management/schools/abc-123");
    expect(ADMIN_ROUTES.divisionSummaryFacet("learners")).toBe(
      "/admin/monitoring/division-summary/learners"
    );
    expect(ADMIN_ROUTES.newSchool).toBe(`${ADMIN_ROUTES.schools}/new`);
  });

  it("leaves Developer Controls and account pages at their original paths", () => {
    expect(ADMIN_ROUTES.audit).toBe("/admin/audit");
    expect(ADMIN_ROUTES.errors).toBe("/admin/errors");
    expect(ADMIN_ROUTES.testLab).toBe("/admin/test-lab");
    expect(ADMIN_ROUTES.archive).toBe("/admin/archive");
    expect(ADMIN_ROUTES.database).toBe("/admin/database");
    expect(ADMIN_ROUTES.profile).toBe("/admin/profile");
    expect(ADMIN_ROUTES.settings).toBe("/admin/settings");
    expect(ADMIN_ROUTES.chat).toBe("/admin/chat");
  });

  it("maps every pre-restructure path to a live route and never to itself", () => {
    const live = new Set<string>(
      Object.values(ADMIN_ROUTES).filter((v) => typeof v === "string") as string[]
    );
    for (const [legacy, target] of Object.entries(LEGACY_ADMIN_REDIRECTS)) {
      expect(live.has(target), `${legacy} -> ${target}`).toBe(true);
      expect(target).not.toBe(legacy);
    }
    expect(Object.keys(LEGACY_ADMIN_REDIRECTS).sort()).toEqual(
      [
        "/admin/accounts",
        "/admin/ip-learners",
        "/admin/school-accounts",
        "/admin/school-years",
        "/admin/schools",
        "/admin/settings/submissions",
        "/admin/submissions",
        "/admin/summary",
        "/admin/support",
        "/admin/term-subjects",
        "/admin/transfers",
      ].sort()
    );
  });
});

describe("withSearchParams", () => {
  it("returns the bare path when there are no params", () => {
    expect(withSearchParams("/admin/x", {})).toBe("/admin/x");
  });

  it("appends params as a query string", () => {
    expect(withSearchParams("/admin/x", { q: "cruz", page: "2" })).toBe("/admin/x?q=cruz&page=2");
  });

  it("keeps every value of a repeated key, in order", () => {
    expect(withSearchParams("/admin/x", { grade: ["G1", "G2", "G3"] })).toBe(
      "/admin/x?grade=G1&grade=G2&grade=G3"
    );
  });

  it("skips undefined values, so an absent param never prints as 'undefined'", () => {
    expect(withSearchParams("/admin/x", { q: undefined, page: "1" })).toBe("/admin/x?page=1");
    expect(withSearchParams("/admin/x", { q: undefined })).toBe("/admin/x");
  });

  it("drops omitted keys", () => {
    expect(withSearchParams("/admin/x", { role: "SCHOOL_HEAD", q: "x" }, ["role"])).toBe("/admin/x?q=x");
    expect(withSearchParams("/admin/x", { role: ["A", "B"] }, ["role"])).toBe("/admin/x");
  });

  it("percent-encodes values and keeps an empty-string value", () => {
    expect(withSearchParams("/admin/x", { q: "a b&c=d" })).toBe("/admin/x?q=a+b%26c%3Dd");
    expect(withSearchParams("/admin/x", { q: "" })).toBe("/admin/x?q=");
  });

  it("does not mutate its inputs", () => {
    const params = { a: ["1", "2"], b: "x" };
    const omit = ["b"] as const;
    withSearchParams("/p", params, omit);
    expect(params).toEqual({ a: ["1", "2"], b: "x" });
    expect(omit).toEqual(["b"]);
  });
});

describe("accountsRoleRoute", () => {
  it("sends SCHOOL_HEAD to School Heads and DISTRICT_ADMIN to District Admins", () => {
    expect(accountsRoleRoute("SCHOOL_HEAD")).toBe(ADMIN_ROUTES.schoolHeads);
    expect(accountsRoleRoute("DISTRICT_ADMIN")).toBe(ADMIN_ROUTES.districtAdmins);
  });

  it("sends TEACHER, SUPER_ADMIN, unknown and missing roles to Teachers", () => {
    expect(accountsRoleRoute("TEACHER")).toBe(ADMIN_ROUTES.teachers);
    expect(accountsRoleRoute("SUPER_ADMIN")).toBe(ADMIN_ROUTES.teachers);
    expect(accountsRoleRoute("bogus")).toBe(ADMIN_ROUTES.teachers);
    expect(accountsRoleRoute("")).toBe(ADMIN_ROUTES.teachers);
    expect(accountsRoleRoute(undefined)).toBe(ADMIN_ROUTES.teachers);
  });

  it("uses the first value when the role is repeated", () => {
    expect(accountsRoleRoute(["SCHOOL_HEAD", "TEACHER"])).toBe(ADMIN_ROUTES.schoolHeads);
    expect(accountsRoleRoute(["TEACHER", "SCHOOL_HEAD"])).toBe(ADMIN_ROUTES.teachers);
    expect(accountsRoleRoute([])).toBe(ADMIN_ROUTES.teachers);
  });

  it("is case-sensitive: a lowercase role is not recognised", () => {
    expect(accountsRoleRoute("school_head")).toBe(ADMIN_ROUTES.teachers);
  });
});

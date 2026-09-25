import { describe, expect, it } from "vitest";
import {
  ADMIN_ATTENTION_HREFS,
  buildAdminAttention,
  buildAdminMetaLabel,
} from "@/components/dashboard/admin/attention";

describe("buildAdminAttention", () => {
  it("says the figures are unavailable rather than 'all clear' when counts failed to load", () => {
    const items = buildAdminAttention(null);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("unavailable");
    expect(items[0].href).toBe("");
  });

  it("reports all clear when nothing needs attention", () => {
    const items = buildAdminAttention({
      schoolsTotal: 4,
      schoolsInactive: 0,
      pendingTeacherApprovals: 0,
    });
    expect(items.map((i) => i.id)).toEqual(["all-clear"]);
    expect(items[0].href).toBe("");
  });

  it("points at the first school when none exist", () => {
    const items = buildAdminAttention({
      schoolsTotal: 0,
      schoolsInactive: 0,
      pendingTeacherApprovals: 0,
    });
    expect(items.map((i) => i.id)).toEqual(["no-schools"]);
    expect(items[0].href).toBe(ADMIN_ATTENTION_HREFS.newSchool);
  });

  it("lists inactive schools and pending teachers with their counts as badges", () => {
    const items = buildAdminAttention({
      schoolsTotal: 5,
      schoolsInactive: 2,
      pendingTeacherApprovals: 1,
    });
    expect(items.map((i) => i.id)).toEqual(["inactive-schools", "pending-teachers"]);
    expect(items[0]).toMatchObject({
      badge: "2",
      tone: "amber",
      href: ADMIN_ATTENTION_HREFS.inactiveSchools,
      detail: "2 schools are switched off",
    });
    expect(items[1]).toMatchObject({ badge: "1", href: ADMIN_ATTENTION_HREFS.teacherAccounts });
  });

  it("uses the singular for one inactive school", () => {
    const [item] = buildAdminAttention({
      schoolsTotal: 3,
      schoolsInactive: 1,
      pendingTeacherApprovals: 0,
    });
    expect(item.detail).toBe("1 school is switched off");
  });
});

describe("buildAdminMetaLabel", () => {
  it("is omitted when the counts failed to load", () => {
    expect(buildAdminMetaLabel(null)).toBeUndefined();
  });

  it("says so when there are no schools", () => {
    expect(buildAdminMetaLabel({ schoolsTotal: 0, schoolsInactive: 0 })).toBe("No schools yet");
  });

  it("splits the total into active and inactive", () => {
    expect(buildAdminMetaLabel({ schoolsTotal: 12, schoolsInactive: 3 })).toBe(
      "12 schools · 9 active · 3 inactive"
    );
    expect(buildAdminMetaLabel({ schoolsTotal: 1, schoolsInactive: 0 })).toBe(
      "1 school · 1 active · 0 inactive"
    );
  });
});

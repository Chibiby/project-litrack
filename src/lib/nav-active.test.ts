import { describe, expect, it } from "vitest";
import { isNavItemActive } from "./nav-active";

describe("isNavItemActive", () => {
  const items = [
    { href: "/admin", exact: true },
    { href: "/admin/schools" },
    { href: "/admin/schools/new" },
  ];

  it("uses exact match for dashboard roots", () => {
    expect(isNavItemActive("/admin", items, items[0])).toBe(true);
    expect(isNavItemActive("/admin/schools", items, items[0])).toBe(false);
  });

  it("picks the longest matching prefix for nested items", () => {
    expect(isNavItemActive("/admin/schools", items, items[1])).toBe(true);
    expect(isNavItemActive("/admin/schools/new", items, items[1])).toBe(false);
    expect(isNavItemActive("/admin/schools/new", items, items[2])).toBe(true);
  });

  it("ignores ?schoolId= query strings on Super Admin nav hrefs", () => {
    const withQuery = [
      { href: "/school-head?schoolId=abc", exact: true },
      { href: "/school-head/teachers?schoolId=abc" },
      { href: "/school-head/grade-levels?schoolId=abc" },
    ];
    expect(isNavItemActive("/school-head", withQuery, withQuery[0])).toBe(true);
    expect(isNavItemActive("/school-head/teachers", withQuery, withQuery[0])).toBe(false);
    expect(isNavItemActive("/school-head/teachers", withQuery, withQuery[1])).toBe(true);
    expect(isNavItemActive("/school-head/teachers/extra", withQuery, withQuery[1])).toBe(true);
    expect(isNavItemActive("/school-head/grade-levels", withQuery, withQuery[1])).toBe(false);
    expect(isNavItemActive("/school-head/grade-levels", withQuery, withQuery[2])).toBe(true);
  });
});

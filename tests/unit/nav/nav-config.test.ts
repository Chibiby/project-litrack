import { describe, expect, it } from "vitest";
import {
  flattenNavGroups,
  getNavGroups,
  resolveActiveHref,
  resolveActiveItemId,
  resolvePageTitle,
  type NavGrade,
  type NavGroup,
} from "@/lib/nav/nav-config";

const oneAral = [{ id: "g1", label: "Grade 3", hasAral: true }];
const twoAral = [
  { id: "g1", label: "Grade 3", hasAral: true },
  { id: "g2", label: "Grade 4", hasAral: true },
];

describe("getNavGroups — teacher", () => {
  it("splits nav into MENU, ARAL PROGRAM and a trailing ungrouped item", () => {
    const groups = getNavGroups("TEACHER", oneAral);
    expect(groups.map((g) => g.label)).toEqual(["Menu", "ARAL Program", undefined]);
    // Term reports is a per-term GRADES report, so it belongs beside the roster
    // it reports on, not under the ARAL programme.
    expect(groups[0].items.map((i) => i.label)).toEqual([
      "Dashboard",
      "Learners",
      "End of Terms Reports",
    ]);
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "Weekly Attendance",
      "Monthly Reading Level",
    ]);
    expect(groups[2].items.map((i) => i.label)).toEqual(["Reports"]);
  });

  it("parks nothing in the teacher nav on an href another item already serves", () => {
    // The property this case has always been about: no row announces a route that
    // a different row actually owns. It used to hold because the one `soon` item
    // was the term report sitting on the live /teacher/reports href; now it holds
    // because the term report shipped and NOTHING in the tree is parked at all.
    // Stated as an empty filter rather than deleted, because a future `soon` row
    // dropped in on top of a live href is the same bug wearing new clothes.
    const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));
    expect(items.filter((i) => i.soon).map((i) => i.id)).toEqual([]);

    // With exactly one ARAL grade every row deep-links, so each owns a distinct
    // route and no two can compete for the highlight or the header title.
    const hrefs = items.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    // Named because these are the two hrefs the term report has wrongly held:
    // /teacher/reports (the parked state) and /teacher/aral (the aralHref
    // regression, covered in its own describe below).
    const terms = items.find((i) => i.id === "teacher-terms-reports");
    expect(terms?.href).toBe("/teacher/terms-reports");
    expect(terms?.soon).toBeUndefined();
    // Live for an ordinary DepEd adviser: no inert treatment on the default path.
    expect(terms?.unavailable).toBeUndefined();
  });

  it("deep-links ARAL items to the single ARAL grade", () => {
    const [, aral] = getNavGroups("TEACHER", oneAral);
    expect(aral.items[0].href).toBe("/teacher/aral/g1/attendance");
    expect(aral.items[1].href).toBe("/teacher/aral/g1/reading-level");
  });

  it("falls back to the grade picker when there is not exactly one ARAL grade", () => {
    for (const grades of [twoAral, [], undefined]) {
      const [, aral] = getNavGroups("TEACHER", grades);
      expect(aral.items[0].href).toBe("/teacher/aral");
      expect(aral.items[1].href).toBe("/teacher/aral");
    }
  });

  it("keeps Learners when no options are passed at all", () => {
    // The third argument defaults, so every existing two-arg caller must keep
    // the full menu — hiding a page from an ordinary teacher would be worse
    // than showing a volunteer one extra link.
    const [menu] = getNavGroups("TEACHER", oneAral);
    expect(menu.items.map((i) => i.id)).toContain("teacher-learners");
    const [explicit] = getNavGroups("TEACHER", oneAral, { isAralVolunteer: false });
    expect(explicit.items.map((i) => i.id)).toContain("teacher-learners");
  });

  it("leaves Learners fully live for an ordinary DepEd adviser", () => {
    // Fail-open is the priority: the volunteer branch must be strictly additive.
    // An `unavailable` key leaking onto the default path would make the sidebar
    // render an inert div with no href for the one role that owns the roster, and
    // every resolver would stop titling/highlighting /teacher/learners.
    for (const groups of [
      getNavGroups("TEACHER", oneAral),
      getNavGroups("TEACHER", oneAral, {}),
      getNavGroups("TEACHER", oneAral, { isAralVolunteer: false }),
    ]) {
      const learners = flattenNavGroups(groups).find((i) => i.id === "teacher-learners");
      expect(learners?.href).toBe("/teacher/learners");
      expect(learners?.unavailable).toBeUndefined();
      // Still owns its route, which is what makes it a real link in the sidebar.
      expect(resolveActiveItemId("/teacher/learners", flattenNavGroups(groups))).toBe(
        "teacher-learners"
      );
    }
  });
});

describe("getNavGroups — ARAL volunteer", () => {
  const volunteer = () => getNavGroups("TEACHER", oneAral, { isAralVolunteer: true });

  it("keeps Learners in the Menu group, in the same slot as for a DepEd teacher", () => {
    // A Non-DepEd ARAL Volunteer advises no section, so /teacher/learners turns
    // them away — but the row stays, inert, so the menu does not quietly lose a
    // line and leave them wondering where Learners went. Order matters as much as
    // presence: the row must sit where it always sat, otherwise a volunteer and a
    // DepEd teacher looking at the same screen see two different menus.
    const [menu] = volunteer();
    expect(menu.label).toBe("Menu");
    expect(menu.items.map((i) => i.label)).toEqual([
      "Dashboard",
      "Learners",
      "End of Terms Reports",
    ]);
    const [ordinaryMenu] = getNavGroups("TEACHER", oneAral);
    expect(menu.items.map((i) => i.id)).toEqual(ordinaryMenu.items.map((i) => i.id));
  });

  it("marks the volunteer's gated rows unavailable, not soon", () => {
    // The two inert flags mean different things and must not be conflated:
    // `soon` promises a later date, `unavailable` names a reason. Swapping them
    // would put a "Soon" pill on a page that already exists and will never open
    // to this account. Both filters feed navigable(), so a test that only checked
    // "is it inert" would pass with the wrong flag set.
    //
    // Two rows to check now rather than one: the term sheet is advisory-gated on
    // exactly the same condition as the roster, so it shut for a volunteer on the
    // same terms when it shipped. The `soon` list is empty because the page is
    // built — a volunteer must not be told to wait for something that exists.
    const items = flattenNavGroups(volunteer());
    expect(items.filter((i) => i.soon).map((i) => i.id)).toEqual([]);
    expect(items.filter((i) => i.unavailable).map((i) => i.id)).toEqual([
      "teacher-learners",
      "teacher-terms-reports",
    ]);
  });

  it("shuts the term report with the same pill and reason as the roster", () => {
    // One wording for one gate. The two rows are closed by the same predicate
    // (`deniesAdvisoryRoster`), so two different explanations of the same refusal
    // would read as two different problems — and the deep page and the resolver
    // page both quote this exact sentence back.
    const items = flattenNavGroups(volunteer());
    const learners = items.find((i) => i.id === "teacher-learners");
    const terms = items.find((i) => i.id === "teacher-terms-reports");

    expect(terms?.unavailable).toEqual({
      pill: "DepEd only",
      reason: "for DepEd teachers who advise a section",
    });
    expect(terms?.unavailable).toEqual(learners?.unavailable);
    // The href stays: it is what the reason refers to, and the sidebar's inert
    // row still needs the item's identity to render its label and icon.
    expect(terms?.href).toBe("/teacher/terms-reports");
  });

  it("gives Learners a DepEd-only pill and a reason, keeping its href", () => {
    const learners = flattenNavGroups(volunteer()).find(
      (i) => i.id === "teacher-learners"
    );
    // The href stays because the reason refers to it — the row still names a real
    // route, it is just shut. Dropping the href would make the row meaningless
    // and break the sidebar's icon/label lookup.
    expect(learners?.href).toBe("/teacher/learners");
    expect(learners?.unavailable?.pill).toBe("DepEd only");
    // Renderers compose "{label} — {reason}" for the tooltip and the sr-only
    // text, so an empty reason would ship a dangling em dash to a screen reader.
    expect(learners?.unavailable?.reason).toBe(
      "for DepEd teachers who advise a section"
    );
    expect((learners?.unavailable?.reason ?? "").trim().length).toBeGreaterThan(0);
  });

  it("keeps the ARAL group — that is the volunteer's actual roster", () => {
    const groups = volunteer();
    expect(groups.map((g) => g.label)).toEqual(["Menu", "ARAL Program", undefined]);
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "Weekly Attendance",
      "Monthly Reading Level",
    ]);
    expect(groups[1].items[0].href).toBe("/teacher/aral/g1/attendance");
    expect(groups[2].items.map((i) => i.label)).toEqual(["Reports"]);
  });

  it("leaves no navigable item pointing at the gated roster", () => {
    // The row exists now, so the old "nothing points at /teacher/learners" rule
    // is gone. What replaced it is narrower and is the property that actually
    // protects the UI: the only item aimed at the gated roster is marked
    // unavailable, so navigable() drops it and no resolver can hand it a
    // highlight, a header title or an active href.
    const items = flattenNavGroups(volunteer());
    const aimedAtRoster = items.filter((i) => i.href.startsWith("/teacher/learners"));
    expect(aimedAtRoster.map((i) => i.id)).toEqual(["teacher-learners"]);
    expect(aimedAtRoster.every((i) => i.unavailable)).toBe(true);
  });

  it("keeps item ids unique with the inert row in the list", () => {
    // The volunteer branch spreads a conditional key onto the shared item rather
    // than appending a second one; a duplicate id would collide React keys in the
    // sidebar and make resolveActiveItemId non-deterministic.
    const ids = flattenNavGroups(volunteer()).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not let either inert row take the highlight", () => {
    // Dashboard wins by role-root prefix instead. If an inert row could win,
    // the sidebar would light up a div that cannot be clicked or focused.
    const items = flattenNavGroups(volunteer());
    expect(resolveActiveItemId("/teacher/learners", items)).not.toBe("teacher-learners");
    expect(resolveActiveItemId("/teacher/learners", items)).toBe("teacher-dashboard");
    // Nested roster routes must behave the same, not just the index.
    expect(resolveActiveItemId("/teacher/learners/abc", items)).not.toBe(
      "teacher-learners"
    );
    // Same for the term sheet: a volunteer can still reach the resolver route by
    // URL (it refuses in place with the same sentence), and while they are there
    // the sidebar must not highlight the row that named it.
    expect(resolveActiveItemId("/teacher/terms-reports", items)).not.toBe(
      "teacher-terms-reports"
    );
    expect(resolveActiveItemId("/teacher/terms-reports", items)).toBe(
      "teacher-dashboard"
    );
    // And it must not supply the header title either — the humanised segment does,
    // exactly as it does for the gated roster.
    expect(resolvePageTitle("/teacher/terms-reports", volunteer())).toBe(
      "Terms reports"
    );
  });

  it("still titles the roster page sanely for a volunteer", () => {
    // No navigable item owns /teacher/learners for a volunteer, so the title
    // falls through to the humanised last segment — which lands on "Learners"
    // anyway. That is the acceptable outcome: the header names the page they are
    // on (the page itself explains the refusal in its EmptyState) instead of
    // going blank or misreporting "Dashboard" from the role-root match.
    //
    // The nested case is the load-bearing one. On the index both a filtered and
    // an unfiltered resolver return "Learners" — one from the segment, one from
    // the item label — so only /teacher/learners/abc tells them apart: skipping
    // the inert row gives "Abc", counting it would give "Learners".
    const groups = volunteer();
    expect(resolvePageTitle("/teacher/learners", groups)).toBe("Learners");
    expect(resolvePageTitle("/teacher/learners/abc", groups)).toBe("Abc");
    // The volunteer's own surfaces are unaffected by the skip.
    expect(resolvePageTitle("/teacher", groups)).toBe("Dashboard");
  });

  it("still highlights Dashboard if a volunteer reaches the roster by URL", () => {
    // They can still be linked there (the dashboard cards do it), so the gate
    // page must not leave the sidebar with nothing lit — the teacher role root
    // prefix-matches and Dashboard stays active.
    const items = flattenNavGroups(volunteer());
    expect(resolveActiveHref("/teacher/learners", items)).toBe("/teacher");
  });
});

/**
 * Regression cases for the term report's href.
 *
 * It shipped briefly as `aralHref(grades, "terms-reports")`, which is wrong on
 * two counts. `aralHref` falls back to the LIVE `/teacher/aral` picker whenever
 * the teacher does not hold exactly one ARAL grade, and this row precedes both
 * ARAL rows in the flattened list — href ties break by list order, so it stole
 * both the highlight and the header title from the ARAL picker. And `hasAral` is
 * the wrong axis entirely: the sheet is advisory-gated, so a DepEd adviser with
 * zero ARAL learners is entitled to it and would have been sent somewhere else.
 */
describe("getNavGroups — the term report's href", () => {
  /** Every grade payload the sidebar can hand in, including the fallback ones. */
  const payloads: [string, NavGrade[] | undefined][] = [
    ["zero grades", []],
    ["one ARAL grade", oneAral],
    ["two ARAL grades", twoAral],
    ["no grade argument at all", undefined],
  ];

  const termsRow = (grades: NavGrade[] | undefined) =>
    flattenNavGroups(getNavGroups("TEACHER", grades)).find(
      (i) => i.id === "teacher-terms-reports"
    );

  for (const [name, grades] of payloads) {
    it(`points at the static resolver with ${name}`, () => {
      // A plain string, not a function of the grade payload. The resolver page
      // does the advisory lookup the sidebar's cached grade list cannot.
      expect(termsRow(grades)?.href).toBe("/teacher/terms-reports");
    });
  }

  it("does not follow the ARAL rows into their picker fallback", () => {
    // The zero- and two-grade cases ARE the bug: `aralHref` collapses to
    // /teacher/aral for both, so if the term report were built the same way it
    // would land on a live route it does not own. Assert the ARAL rows really do
    // fall back here, otherwise this case could pass for the wrong reason.
    for (const grades of [[], twoAral, undefined] as (NavGrade[] | undefined)[]) {
      const groups = getNavGroups("TEACHER", grades);
      expect(groups[1].items.map((i) => i.href)).toEqual([
        "/teacher/aral",
        "/teacher/aral",
      ]);
      expect(termsRow(grades)?.href).toBe("/teacher/terms-reports");
      expect(termsRow(grades)?.href).not.toBe("/teacher/aral");
    }
  });

  it("never steals the ARAL picker's highlight", () => {
    for (const [, grades] of payloads) {
      const items = flattenNavGroups(getNavGroups("TEACHER", grades));
      expect(resolveActiveItemId("/teacher/aral", items)).not.toBe(
        "teacher-terms-reports"
      );
    }

    // Spelled out per payload, so a regression cannot be masked by "some other
    // row won". With a fallback payload the picker route belongs to the first
    // ARAL row; with a deep-linked one nothing owns it and the role root wins.
    for (const grades of [[], twoAral, undefined] as (NavGrade[] | undefined)[]) {
      const items = flattenNavGroups(getNavGroups("TEACHER", grades));
      expect(resolveActiveItemId("/teacher/aral", items)).toBe(
        "teacher-aral-attendance"
      );
    }
    expect(
      resolveActiveItemId("/teacher/aral", flattenNavGroups(getNavGroups("TEACHER", oneAral)))
    ).toBe("teacher-dashboard");
  });

  it("never steals the ARAL picker's header title", () => {
    // Same regression, different symptom: the header reads its title from the
    // active item's label, so the old href titled the ARAL picker page "End of
    // Terms Reports".
    for (const [, grades] of payloads) {
      const groups = getNavGroups("TEACHER", grades);
      expect(resolvePageTitle("/teacher/aral", groups)).not.toBe(
        "End of Terms Reports"
      );
    }
    expect(resolvePageTitle("/teacher/aral", getNavGroups("TEACHER", twoAral))).toBe(
      "Weekly Attendance"
    );
  });

  it("keeps Reports and the term report on separate routes, both directions", () => {
    // Neither string prefixes the other, but `resolveActiveHref` matches by
    // longest prefix and this is exactly the pair that rots — one rename to
    // /teacher/reports/terms and the two start swallowing each other. Asserted in
    // both directions so a one-sided fix cannot pass.
    const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));
    expect(resolveActiveItemId("/teacher/reports", items)).toBe("teacher-reports");
    expect(resolveActiveItemId("/teacher/terms-reports", items)).toBe(
      "teacher-terms-reports"
    );
    expect(resolveActiveHref("/teacher/reports", items)).toBe("/teacher/reports");
    expect(resolveActiveHref("/teacher/terms-reports", items)).toBe(
      "/teacher/terms-reports"
    );
  });

  it("titles the resolver route after the term report", () => {
    const groups = getNavGroups("TEACHER", oneAral);
    expect(resolvePageTitle("/teacher/terms-reports", groups)).toBe(
      "End of Terms Reports"
    );
    // And the neighbouring Reports route keeps its own label.
    expect(resolvePageTitle("/teacher/reports", groups)).toBe("Reports");
  });
});

/**
 * Regression cases for the OTHER branch of the same href — the deep one, built
 * from `options.advisoryGradeLevelId`.
 *
 * The fallback above (`/teacher/terms-reports`) is a resolver page: it looks up
 * the adviser's grade and redirects to `/teacher/aral/<gradeId>/terms-reports`.
 * After that redirect no nav item matched the URL, so longest-prefix fell all the
 * way through to the `/teacher` role root — the sidebar highlighted **Dashboard**
 * and the header titled the page **"Terms reports"** (a humanised URL segment)
 * while the page's own `<h1>` read "End of Terms Reports — Grade 7". Handing the
 * advised grade to the nav lets the row name the URL the teacher lands on.
 *
 * Every case here pins both directions, because the fix moves the row's href
 * *underneath* `/teacher/aral`: it must win its own URL, and it must still not
 * take a route the ARAL rows own when they collapse to the picker.
 */
describe("getNavGroups — the term report's deep href", () => {
  /** The URL the resolver redirects an adviser of grade `g1` to. */
  const SHEET = "/teacher/aral/g1/terms-reports";

  /**
   * Every grade payload the sidebar can hand in, with the ARAL rows' resulting
   * href and who owns the bare picker route under it. `aralHref` collapses both
   * ARAL rows onto `/teacher/aral` unless the teacher holds exactly ONE ARAL
   * grade — and `/teacher/aral` is a prefix of SHEET, so in three of these four
   * payloads the ARAL rows also match the sheet's URL and only longest-prefix
   * matching awards it to the term report. This is the interaction most likely to
   * break silently if the groups are reordered or `resolveActiveHref` is touched.
   */
  const payloads: {
    name: string;
    grades: NavGrade[] | undefined;
    aralRowHref: string;
    /** Active id on `/teacher/aral` itself, per payload. */
    pickerOwner: string;
  }[] = [
    { name: "zero ARAL grades", grades: [], aralRowHref: "/teacher/aral", pickerOwner: "teacher-aral-attendance" },
    {
      name: "exactly one ARAL grade",
      grades: oneAral,
      aralRowHref: "/teacher/aral/g1/attendance",
      // Both ARAL rows deep-link, so nothing owns the picker route and the role
      // root wins it on prefix.
      pickerOwner: "teacher-dashboard",
    },
    { name: "two ARAL grades", grades: twoAral, aralRowHref: "/teacher/aral", pickerOwner: "teacher-aral-attendance" },
    { name: "no grade argument at all", grades: undefined, aralRowHref: "/teacher/aral", pickerOwner: "teacher-aral-attendance" },
  ];

  const itemsFor = (grades: NavGrade[] | undefined, advisoryGradeLevelId: string | null) =>
    flattenNavGroups(getNavGroups("TEACHER", grades, { advisoryGradeLevelId }));

  const termsRow = (grades: NavGrade[] | undefined, advisoryGradeLevelId: string | null) =>
    itemsFor(grades, advisoryGradeLevelId).find((i) => i.id === "teacher-terms-reports");

  it("deep-links the row at the advised grade's sheet", () => {
    expect(termsRow(oneAral, "g1")?.href).toBe("/teacher/aral/g1/terms-reports");
    // Interpolated, not hard-coded to the fixture's id: the real value is a cuid
    // off the shell context, and a hard-coded segment would send every teacher to
    // one grade's sheet.
    expect(termsRow(oneAral, "cl_grade7_xyz")?.href).toBe(
      "/teacher/aral/cl_grade7_xyz/terms-reports"
    );
    // The grade comes from the ADVISED section, not from `hasAral`: a DepEd
    // adviser with zero ARAL learners is still entitled to the sheet.
    expect(termsRow([], "g1")?.href).toBe("/teacher/aral/g1/terms-reports");
    // And the deep href is the only thing the option changes — it must not leak
    // into the ARAL rows or make the row inert for an ordinary adviser.
    expect(termsRow(oneAral, "g1")?.unavailable).toBeUndefined();
    expect(termsRow(oneAral, "g1")?.soon).toBeUndefined();
  });

  it("keeps the resolver fallback for absent, null and undefined alike", () => {
    // Three call shapes, one expected href. `null` and `undefined` reach the
    // ternary differently from an omitted option, and the guard is a truthiness
    // check — rewrite it as `!== undefined` and `null` starts building
    // /teacher/aral/null/terms-reports, a 404 the teacher cannot get out of.
    const shapes: [string, NavGroup[]][] = [
      ["options omitted entirely", getNavGroups("TEACHER", oneAral)],
      ["empty options object", getNavGroups("TEACHER", oneAral, {})],
      ["explicit null", getNavGroups("TEACHER", oneAral, { advisoryGradeLevelId: null })],
      [
        "explicit undefined",
        getNavGroups("TEACHER", oneAral, { advisoryGradeLevelId: undefined }),
      ],
      // The other option must not stand in for this one.
      [
        "only isAralVolunteer: false",
        getNavGroups("TEACHER", oneAral, { isAralVolunteer: false }),
      ],
    ];
    for (const [name, groups] of shapes) {
      const href = flattenNavGroups(groups).find((i) => i.id === "teacher-terms-reports")
        ?.href;
      expect(href, name).toBe("/teacher/terms-reports");
      // Spelled out because a stringified empty value is the failure mode that
      // still *looks* like a deep link in a diff.
      expect(href, name).not.toContain("null");
      expect(href, name).not.toContain("undefined");
    }
  });

  it("gives the sheet's own URL to the term report, not Dashboard", () => {
    // THE regression. With the fallback href nothing matched this URL past the
    // role root, so the sidebar lit up Dashboard on a page whose h1 read "End of
    // Terms Reports — Grade 7". Both halves asserted: the positive says who owns
    // it, the negative names the bug in the failure message.
    const items = itemsFor(oneAral, "g1");
    expect(resolveActiveItemId(SHEET, items)).toBe("teacher-terms-reports");
    expect(resolveActiveItemId(SHEET, items)).not.toBe("teacher-dashboard");
    // The href resolver underneath it, so a failure says whether the winning
    // prefix or the id lookup broke.
    expect(resolveActiveHref(SHEET, items)).toBe(SHEET);
  });

  it("titles the sheet after the row, not after its URL segment", () => {
    // Same regression, second symptom: the header falls back to a humanised last
    // segment when no navigable item owns the route, so an adviser saw "Terms
    // reports" in the chrome above an h1 reading "End of Terms Reports".
    const groups = getNavGroups("TEACHER", oneAral, { advisoryGradeLevelId: "g1" });
    expect(resolvePageTitle(SHEET, groups)).toBe("End of Terms Reports");
    expect(resolvePageTitle(SHEET, groups)).not.toBe("Terms reports");
  });

  for (const { name, grades, aralRowHref } of payloads) {
    it(`wins the sheet's URL over the ARAL rows with ${name}`, () => {
      const groups = getNavGroups("TEACHER", grades, { advisoryGradeLevelId: "g1" });
      const items = flattenNavGroups(groups);

      // Assert the ARAL rows really are where we think first, otherwise the rest
      // of this case can pass for the wrong reason — with 0 or 2+ ARAL grades
      // they collapse onto /teacher/aral, which PREFIXES the sheet's URL.
      expect(groups[1].items.map((i) => i.href)).toEqual([
        aralRowHref,
        aralRowHref.replace("attendance", "reading-level"),
      ]);
      if (aralRowHref === "/teacher/aral") {
        expect(SHEET.startsWith(`${aralRowHref}/`)).toBe(true);
      }

      // Only longest-prefix matching separates them, so pin the winning href as
      // well as the id — the term report's own href, not the picker's.
      expect(resolveActiveHref(SHEET, items)).toBe(SHEET);
      expect(resolveActiveItemId(SHEET, items)).toBe("teacher-terms-reports");
      expect(resolveActiveItemId(SHEET, items)).not.toBe("teacher-aral-attendance");
      expect(resolvePageTitle(SHEET, groups)).toBe("End of Terms Reports");
    });
  }

  for (const { name, grades, pickerOwner } of payloads) {
    it(`does not steal an ARAL row's route with ${name}`, () => {
      // The mirror of the bug the fallback href was chosen to avoid. A deep href
      // one segment below the picker must not swallow the picker or a sibling
      // grade route: this row precedes both ARAL rows, so an href tie or a
      // sloppier match rule hands it their highlight.
      const groups = getNavGroups("TEACHER", grades, { advisoryGradeLevelId: "g1" });
      const items = flattenNavGroups(groups);

      expect(resolveActiveItemId("/teacher/aral", items)).not.toBe(
        "teacher-terms-reports"
      );
      expect(resolveActiveItemId("/teacher/aral", items)).toBe(pickerOwner);
      expect(resolvePageTitle("/teacher/aral", groups)).not.toBe(
        "End of Terms Reports"
      );

      // A sibling grade-scoped page, one the teacher reaches constantly. Same
      // /teacher/aral/g1/ parent as the sheet, and the same advised grade.
      expect(resolveActiveItemId("/teacher/aral/g1/attendance", items)).not.toBe(
        "teacher-terms-reports"
      );
      expect(resolveActiveItemId("/teacher/aral/g1/attendance", items)).toBe(
        "teacher-aral-attendance"
      );
      expect(resolvePageTitle("/teacher/aral/g1/attendance", groups)).toBe(
        "Weekly Attendance"
      );

      // And the neighbouring Reports route, the href this row was parked on
      // before it shipped, stays with the item that serves it.
      expect(resolveActiveItemId("/teacher/reports", items)).toBe("teacher-reports");
      expect(resolvePageTitle("/teacher/reports", groups)).toBe("Reports");
    });
  }

  it("leaves the resolver route unowned once the row deep-links", () => {
    // The documented consequence of moving the href, recorded rather than
    // asserted away: with an advised grade nothing in the nav names
    // /teacher/terms-reports any more, so that URL falls to the role root. It is
    // acceptable only because the page there redirects to SHEET immediately — a
    // teacher never sees the chrome resolve on it. If that page is ever made to
    // render in place for an adviser, this is the assertion that must change,
    // and it should change deliberately.
    const items = itemsFor(oneAral, "g1");
    expect(items.some((i) => i.href === "/teacher/terms-reports")).toBe(false);
    expect(resolveActiveItemId("/teacher/terms-reports", items)).toBe(
      "teacher-dashboard"
    );
  });

  it("keeps a volunteer's deep-href row inert on its own URL", () => {
    // A volunteer advises no section, so the shell should not hand one an
    // advisory grade at all — but if it ever did, `unavailable` has to keep
    // winning. `navigable()` drops the row, so the deep href cannot light up a
    // div that has no tab stop and cannot be clicked. Belt and braces: the two
    // options compose here, they do not overwrite each other.
    for (const { name, grades, aralRowHref } of payloads) {
      const items = flattenNavGroups(
        getNavGroups("TEACHER", grades, {
          isAralVolunteer: true,
          advisoryGradeLevelId: "g1",
        })
      );
      const terms = items.find((i) => i.id === "teacher-terms-reports");
      // Deep href AND inert — the volunteer branch must not silently drop the
      // href, and the deep branch must not silently drop the reason.
      expect(terms?.href, name).toBe(SHEET);
      expect(terms?.unavailable, name).toEqual({
        pill: "DepEd only",
        reason: "for DepEd teachers who advise a section",
      });
      expect(resolveActiveItemId(SHEET, items), name).not.toBe("teacher-terms-reports");
      // Spelled out per payload so a regression cannot hide behind "some other
      // row won": the ARAL rows take it when they collapse to the picker,
      // otherwise the role root does.
      expect(resolveActiveItemId(SHEET, items), name).toBe(
        aralRowHref === "/teacher/aral" ? "teacher-aral-attendance" : "teacher-dashboard"
      );
    }
  });
});

describe("getNavGroups — admin", () => {
  it("keeps admin on a single unlabeled group", () => {
    // The redesign regrouped the School Head sidebar only; admin was left
    // alone on purpose, so its flat shape is part of the contract now rather
    // than an accident of the two roles once sharing a branch.
    const groups = getNavGroups("SUPER_ADMIN");
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBeUndefined();
    expect(groups[0].items[0].href).toBe("/admin");
  });
});

describe("getNavGroups — school head", () => {
  it("splits nav into a lone Dashboard, Manage and Records", () => {
    const groups = getNavGroups("SCHOOL_HEAD");
    expect(groups.map((g) => g.label)).toEqual([undefined, "Manage", "Records"]);
    // Dashboard sits above the labelled groups on its own so it reads as the
    // landing page, not as the first of the things you manage.
    expect(groups[0].items.map((i) => i.label)).toEqual(["Dashboard"]);
    expect(groups[0].items[0].href).toBe("/school-head");
    // Manage is what a School Head changes, Records what they publish or read
    // back. "School" is one entry because school years, grade levels and school
    // info are tabs of one workspace now, not three separate destinations.
    expect(groups[1].items.map((i) => i.label)).toEqual([
      "School",
      "Teachers",
      "ARAL Program",
      "Transfer",
    ]);
    expect(groups[2].items.map((i) => i.label)).toEqual([
      "Announcements",
      "Reports",
      "Audit",
    ]);
  });

  it("points Teachers at the workspace root so every tab keeps it highlighted", () => {
    const items = flattenNavGroups(getNavGroups("SCHOOL_HEAD"));
    expect(items.find((i) => i.id === "school-head-teachers")?.href).toBe(
      "/school-head/teachers"
    );
    // Longest-prefix matching is what lets one sidebar entry serve all four tab
    // routes. A tab-specific href here would leave three of the four tabs
    // highlighting nothing but Dashboard.
    for (const tab of ["pending", "inactive", "declined"]) {
      expect(resolveActiveHref(`/school-head/teachers/${tab}`, items)).toBe(
        "/school-head/teachers"
      );
    }
  });
});

describe("resolveActiveHref", () => {
  const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));

  it("prefers the longest matching prefix over the role home", () => {
    expect(resolveActiveHref("/teacher/learners/abc", items)).toBe("/teacher/learners");
  });

  it("matches the role home only exactly", () => {
    expect(resolveActiveHref("/teacher", items)).toBe("/teacher");
  });

  it("returns undefined for an unmatched path", () => {
    expect(resolveActiveHref("/account/set-password", items)).toBeUndefined();
  });

  it("restores plain longest-prefix matching for role roots (SUPER_ADMIN/SCHOOL_HEAD parity)", () => {
    const adminItems = flattenNavGroups(getNavGroups("SUPER_ADMIN"));
    expect(resolveActiveHref("/admin/settings", adminItems)).toBe("/admin");
  });

  it("still prefix-matches the teacher role root for non-nav nested routes", () => {
    expect(resolveActiveHref("/teacher/settings/change-password", items)).toBe("/teacher");
  });
});

describe("resolveActiveItemId", () => {
  it("gives /teacher/reports to the item that serves it", () => {
    // "End of Terms Reports" used to be parked on /teacher/reports with
    // `soon: true`, and it comes FIRST in the flattened list — so the soon filter
    // was the only thing stopping it taking the highlight from the Reports page.
    // It owns its own route now, and Reports must keep hold of this one either
    // way: this is the assertion that catches the parked href coming back.
    const items = flattenNavGroups(getNavGroups("TEACHER", oneAral));
    expect(resolveActiveItemId("/teacher/reports", items)).toBe("teacher-reports");
  });

  it("resolves the first of two colliding live hrefs deterministically", () => {
    const icon = () => null;
    const items = [
      { id: "first", label: "First", href: "/x", icon },
      { id: "second", label: "Second", href: "/x", icon },
    ];
    expect(resolveActiveItemId("/x", items)).toBe("first");
  });

  it("produces unique ids within each role's flattened nav list", () => {
    for (const [role, grades] of [
      ["TEACHER", oneAral],
      ["SUPER_ADMIN", undefined],
      ["SCHOOL_HEAD", undefined],
    ] as const) {
      const items = flattenNavGroups(getNavGroups(role, grades));
      const ids = items.map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("resolvePageTitle", () => {
  const groups = getNavGroups("TEACHER", oneAral);

  it("uses the active nav item label", () => {
    expect(resolvePageTitle("/teacher", groups)).toBe("Dashboard");
    expect(resolvePageTitle("/teacher/learners/abc", groups)).toBe("Learners");
  });

  it("titles a route after the item that serves it, not the row above it", () => {
    // Two distinct labels on two adjacent routes; the term report sat on this one
    // while it was parked, so a title of "End of Terms Reports" here is the shape
    // of that regression returning.
    expect(resolvePageTitle("/teacher/reports", groups)).toBe("Reports");
    expect(resolvePageTitle("/teacher/terms-reports", groups)).toBe(
      "End of Terms Reports"
    );
  });

  it("falls back to a humanised last segment when nothing matches", () => {
    expect(resolvePageTitle("/teacher/settings/change-password", groups)).toBe(
      "Change password"
    );
  });

  it("falls back to LITRACK at the root", () => {
    expect(resolvePageTitle("/", groups)).toBe("LITRACK");
  });
});

import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/teacher" }));
/**
 * Which row Next currently reports as navigating. Held as an href rather than a
 * boolean so the mock can answer per-link — a global flag would make every row
 * pending at once and the "only the clicked row spins" case unfalsifiable.
 */
const pendingHref = vi.hoisted(() => ({ value: null as string | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", async () => {
  const { createContext, useContext } = await import("react");
  // The real `useLinkStatus` reads the enclosing Link, so the mock has to carry
  // an enclosing Link too. A context provider adds no DOM node, so every
  // existing assertion about this subtree still holds.
  const HrefContext = createContext<string | null>(null);
  return {
    default: ({ children, href, prefetch: _p, ...rest }: any) => (
      <a href={href} {...rest}>
        <HrefContext.Provider value={href}>{children}</HrefContext.Provider>
      </a>
    ),
    useLinkStatus: () => ({
      pending:
        pendingHref.value !== null && useContext(HrefContext) === pendingHref.value,
    }),
  };
});
vi.mock("@/components/nav-prefetcher", () => ({
  NavPrefetcher: () => null,
}));
vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }));

import { AppSidebar } from "@/components/app-sidebar";

afterEach(cleanup);
afterEach(() => {
  // Module-level, so it would otherwise leak a spinning row into later cases.
  pendingHref.value = null;
});

function renderTeacherSidebar(props?: {
  roleLabel?: string;
  isAralVolunteer?: boolean;
  /**
   * The advised section's grade level, as the shell context supplies it. Omitted
   * here by default so the shared cases exercise the resolver-href fallback;
   * pass it to get the grade-scoped sheet href.
   */
  advisoryGradeLevelId?: string | null;
  /** Desktop rail. Spread after the default so `false` collapses it. */
  expanded?: boolean;
}) {
  return render(
    <AppSidebar
      role="TEACHER"
      userName="Marivic M. Acibar"
      schoolName="Malandag Central Elementary"
      grades={[{ id: "g1", label: "Grade 3", hasAral: true }]}
      expanded
      {...props}
    />
  );
}

describe("AppSidebar — teacher", () => {
  beforeEach(() => {
    pathname.value = "/teacher";
  });

  it("renders both section headings", () => {
    renderTeacherSidebar();
    expect(screen.getAllByText("Menu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ARAL Program").length).toBeGreaterThan(0);
  });

  it("renders the ARAL program links", () => {
    renderTeacherSidebar();
    expect(
      screen.getAllByRole("link", { name: "Weekly Attendance" })[0].getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
    expect(
      screen
        .getAllByRole("link", { name: "Monthly Reading Level" })[0]
        .getAttribute("href")
    ).toBe("/teacher/aral/g1/reading-level");
  });

  it("marks only the active item with aria-current", () => {
    renderTeacherSidebar();
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.every((el) => el.textContent?.includes("Dashboard"))).toBe(true);
  });

  it("shows the brand block with the school name", () => {
    renderTeacherSidebar();
    expect(screen.getAllByText("LITRACK").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Malandag Central Elementary").length
    ).toBeGreaterThan(0);
  });

  it("renders a log out control in the footer", () => {
    renderTeacherSidebar();
    // SignOutButton's visible label is "Sign out".
    expect(
      screen.getAllByRole("button", { name: /sign out|log ?out/i }).length
    ).toBeGreaterThan(0);
  });

  it("names the account by the humanised role when no label is supplied", () => {
    renderTeacherSidebar();
    // Rendered lowercase and CSS-capitalised, so assert on the DOM text.
    expect(screen.getAllByText("teacher").length).toBeGreaterThan(0);
  });

  it("names an ARAL Volunteer by their designation instead of their role", () => {
    // A Non-DepEd ARAL Volunteer holds the TEACHER role, so the enum is the wrong
    // thing to show them. The nav still has to be a teacher's nav.
    renderTeacherSidebar({ roleLabel: "ARAL Volunteer" });
    expect(screen.getAllByText("ARAL Volunteer").length).toBeGreaterThan(0);
    expect(screen.queryByText("teacher")).toBeNull();
    expect(screen.getAllByText("ARAL Program").length).toBeGreaterThan(0);
  });

  it("renders Learners inert with a DepEd-only pill for an ARAL volunteer", () => {
    // The volunteer advises no section, so /teacher/learners turns them away — but
    // the row STAYS, inert, instead of disappearing: a menu that quietly loses a
    // line invites "where did Learners go", an inert row answers it in place.
    // Asserted here as well as on getNavGroups, because the failure this catches
    // is the prop silently stopping at the shell instead of reaching the config.
    renderTeacherSidebar({ roleLabel: "ARAL Volunteer", isAralVolunteer: true });

    // Both halves of this pair matter. On its own the "no link" assertion below
    // also passes when the row vanishes entirely, which is the behaviour we were
    // asked to stop — so the presence of the text is what pins the new treatment.
    expect(screen.getAllByText("Learners").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DepEd only").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Learners" })).toBeNull();
    // Belt and braces on the accessible-name query: no anchor in the sidebar may
    // point at the gated roster, whatever its computed name turns out to be.
    expect(
      screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    ).not.toContain("/teacher/learners");

    // aria-disabled is what tells assistive tech the row is inert; a plain div
    // with no href is what keeps a keyboard from landing on a dead end.
    const row = screen.getAllByText("Learners")[0].closest("[aria-disabled]");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.tagName).toBe("DIV");
    expect(row?.hasAttribute("href")).toBe(false);
    expect(row?.hasAttribute("tabindex")).toBe(false);

    // The pill fits two words, so the reason rides sr-only text — and since an
    // inert row has no tab stop, no tooltip a keyboard can reach, this line is the
    // only place a screen-reader user learns WHY the row is shut.
    const reason = screen.getAllByText(
      "Learners — for DepEd teachers who advise a section"
    );
    expect(reason.length).toBeGreaterThan(0);
    // Same reasoning as the casing assertion below: jsdom does not apply Tailwind,
    // so the class is the only observable proof the reason is for assistive tech
    // only. Drop `sr-only` and every inert row grows a visible second line of copy
    // duplicating its own label.
    expect(reason[0].className).toContain("sr-only");

    // The row has to stay WHERE IT WAS — second in Menu, between Dashboard and the
    // term report. Presence alone would still pass if it were appended to the
    // bottom of the nav, and the point of keeping it is that a volunteer sees the
    // same shaped menu as the DepEd teacher beside them.
    const navText =
      screen.getAllByRole("navigation", { name: "Primary" })[0].textContent ?? "";
    expect(navText.indexOf("Dashboard")).toBeLessThan(navText.indexOf("Learners"));
    expect(navText.indexOf("Learners")).toBeLessThan(
      navText.indexOf("End of Terms Reports")
    );

    // jsdom does not compute text-transform, so the class is the only observable
    // proof that an unavailability pill is NOT upper-cased. It names a thing, and
    // "DEPED ONLY" would mangle the proper noun; the uppercase treatment belongs
    // to the `soon` status word, which no teacher row carries any more.
    expect(screen.getAllByText("DepEd only")[0].className).not.toContain("uppercase");

    // Everything that is not advisory-scoped stays a real, clickable link.
    expect(
      screen.getAllByRole("link", { name: "Weekly Attendance" })[0].getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
    expect(
      screen
        .getAllByRole("link", { name: "Monthly Reading Level" })[0]
        .getAttribute("href")
    ).toBe("/teacher/aral/g1/reading-level");
    expect(
      screen.getAllByRole("link", { name: "Dashboard" })[0].getAttribute("href")
    ).toBe("/teacher");
    expect(
      screen.getAllByRole("link", { name: "Reports" })[0].getAttribute("href")
    ).toBe("/teacher/reports");
  });

  it("keeps the volunteer's reason reachable on the collapsed rail", () => {
    // Collapsed there is no room for the pill, so the state rides a muted dot —
    // and that dot is aria-hidden. If the sr-only reason did not survive collapse,
    // a volunteer on a narrow desktop would get an unexplained greyed-out icon.
    renderTeacherSidebar({
      roleLabel: "ARAL Volunteer",
      isAralVolunteer: true,
      expanded: false,
    });
    expect(
      screen.getAllByText("Learners — for DepEd teachers who advise a section").length
    ).toBeGreaterThan(0);
    const row = screen
      .getAllByText("Learners — for DepEd teachers who advise a section")[0]
      .closest("[aria-disabled]");
    expect(row).not.toBeNull();
    // The expanded row is returned bare, but the collapsed one is wrapped in a
    // Tooltip with `asChild`, so the trigger's props land on this div. That path
    // must not acquire a tab stop: Radix stamps only data-state on it today, and
    // a focusable row with nothing to activate is the dead end the no-href
    // treatment exists to avoid. Asserted here because the expanded test cannot
    // catch it — that branch never goes through TooltipTrigger.
    expect(row?.tagName).toBe("DIV");
    expect(row?.hasAttribute("tabindex")).toBe(false);
    expect(row?.hasAttribute("href")).toBe(false);
    // The dot is decoration only. If it ever stopped being aria-hidden it would
    // announce as a stray bullet next to the reason, so pin it rather than
    // leaving it to the comment.
    expect(row?.querySelector("span[aria-hidden='true']")).not.toBeNull();
    // The pill is expanded-only. (The mobile Sheet, which always renders expanded,
    // is closed here, so nothing else can supply the text.)
    expect(screen.queryByText("DepEd only")).toBeNull();
    expect(screen.queryByRole("link", { name: "Learners" })).toBeNull();
    expect(
      screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    ).not.toContain("/teacher/learners");
  });

  it("renders End of Terms Reports as a live link for an ordinary teacher", () => {
    // It shipped. This case used to assert the opposite — an inert "Soon" row —
    // so it is now the guard against the row being parked again, and against the
    // href regressing to the ARAL picker (`aralHref` falls back to /teacher/aral,
    // which this row precedes in the list and would therefore hijack).
    //
    // This render passes NO `advisoryGradeLevelId`, so what it pins is the
    // fallback branch: the sheet itself lives at
    // /teacher/aral/[gradeId]/terms-reports, and with no advised grade reaching
    // the shell — the teacher advises no section, or the layout's context read
    // failed and defaulted to null — there is no grade to scope it to, so the row
    // names the /teacher/terms-reports resolver, which explains the refusal in
    // place. The adviser's deep href, which DOES ride along on the shell context,
    // is pinned in the next case.
    renderTeacherSidebar();
    const link = screen.getAllByRole("link", { name: "End of Terms Reports" })[0];
    expect(link.getAttribute("href")).toBe("/teacher/terms-reports");
    expect(link.tagName).toBe("A");
    // No inert treatment leaks onto a row a DepEd adviser owns.
    expect(link.closest("[aria-disabled]")).toBeNull();

    // Nothing in the teacher sidebar is announced-but-unbuilt any more, so the
    // pill and its sr-only twin must both be gone — a "Soon" pill on a page that
    // exists tells the teacher to wait for something they can already open.
    expect(screen.queryByText("Soon")).toBeNull();
    expect(screen.queryByText("End of Terms Reports — soon")).toBeNull();
  });

  it("deep-links End of Terms Reports at the advised grade's sheet", () => {
    // The prop the shell now forwards. Asserted at the component and not only on
    // getNavGroups because the failure this catches is the advisory grade
    // stopping at the shell — the config would still be correct while every
    // teacher's sidebar shipped the resolver href.
    renderTeacherSidebar({ advisoryGradeLevelId: "g1" });
    const link = screen.getAllByRole("link", { name: "End of Terms Reports" })[0];
    // A real anchor, not the inert div: the deep branch must not tip the row into
    // the `unavailable` treatment on its way through.
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/teacher/aral/g1/terms-reports");
    expect(link.closest("[aria-disabled]")).toBeNull();
    // The resolver href is gone from the sidebar in this branch — if both were
    // present the row would be duplicated, which is how a half-applied fix looks.
    expect(
      screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    ).not.toContain("/teacher/terms-reports");
    // The ARAL rows keep their own grade-scoped hrefs; the deep term href sits
    // one segment under /teacher/aral and must not disturb them.
    expect(
      screen.getAllByRole("link", { name: "Weekly Attendance" })[0].getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
  });

  it("highlights End of Terms Reports, not Dashboard, on the sheet's URL", () => {
    // The regression the deep href exists to fix, at the level the teacher sees
    // it: after /teacher/terms-reports redirected, no item matched the URL, so
    // longest-prefix fell through to /teacher and the sidebar lit up Dashboard on
    // a page titled "End of Terms Reports — Grade 3".
    pathname.value = "/teacher/aral/g1/terms-reports";
    renderTeacherSidebar({ advisoryGradeLevelId: "g1" });

    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((el) => el.textContent?.includes("End of Terms Reports"))).toBe(
      true
    );
    // Named explicitly so the failure message says which row wrongly won.
    expect(
      screen.getAllByRole("link", { name: "Dashboard" })[0].getAttribute("aria-current")
    ).toBeNull();
    expect(
      screen
        .getAllByRole("link", { name: "Weekly Attendance" })[0]
        .getAttribute("aria-current")
    ).toBeNull();
  });

  it("leaves the ARAL rows highlighted on their own URLs with a deep term href", () => {
    // The mirror: the deep href must not steal a sibling's highlight. Two ARAL
    // grades, so both ARAL rows collapse onto /teacher/aral — a PREFIX of the
    // term sheet's href — which is the arrangement where the two can compete.
    pathname.value = "/teacher/aral";
    render(
      <AppSidebar
        role="TEACHER"
        userName="Marivic M. Acibar"
        grades={[
          { id: "g1", label: "Grade 3", hasAral: true },
          { id: "g2", label: "Grade 4", hasAral: true },
        ]}
        advisoryGradeLevelId="g1"
        expanded
      />
    );
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.length).toBeGreaterThan(0);
    expect(current.every((el) => el.textContent?.includes("Weekly Attendance"))).toBe(
      true
    );
    expect(
      screen
        .getAllByRole("link", { name: "End of Terms Reports" })[0]
        .getAttribute("aria-current")
    ).toBeNull();
  });

  it("keeps End of Terms Reports inert for a volunteer even with an advised grade", () => {
    // A volunteer should never be handed an advisory grade, but if the shell ever
    // did, `unavailable` has to keep winning over the deep href — an inert div
    // with no tab stop, not a link the page would only refuse.
    pathname.value = "/teacher/aral/g1/terms-reports";
    renderTeacherSidebar({
      roleLabel: "ARAL Volunteer",
      isAralVolunteer: true,
      advisoryGradeLevelId: "g1",
    });
    expect(screen.queryByRole("link", { name: "End of Terms Reports" })).toBeNull();
    expect(
      screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    ).not.toContain("/teacher/aral/g1/terms-reports");
    const row = screen
      .getAllByText("End of Terms Reports")[0]
      .closest("[aria-disabled]");
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.hasAttribute("href")).toBe(false);
    // And it takes no highlight on the very URL it names.
    expect(
      screen.getAllByRole("link", { current: "page" }).every(
        (el) => !el.textContent?.includes("End of Terms Reports")
      )
    ).toBe(true);
  });

  it("renders End of Terms Reports inert for an ARAL volunteer", () => {
    // Same advisory gate as Learners, so the same inert treatment: present with a
    // reason rather than missing. Asserted at the component as well as on
    // getNavGroups because the failure this catches is the `isAralVolunteer` prop
    // reaching only one of the two rows.
    renderTeacherSidebar({ roleLabel: "ARAL Volunteer", isAralVolunteer: true });

    expect(screen.queryByRole("link", { name: "End of Terms Reports" })).toBeNull();
    expect(
      screen.getAllByRole("link").map((el) => el.getAttribute("href"))
    ).not.toContain("/teacher/terms-reports");

    const row = screen.getAllByText("End of Terms Reports")[0].closest("[aria-disabled]");
    expect(row).not.toBeNull();
    expect(row?.getAttribute("aria-disabled")).toBe("true");
    expect(row?.tagName).toBe("DIV");
    expect(row?.hasAttribute("href")).toBe(false);
    expect(row?.hasAttribute("tabindex")).toBe(false);

    // The reason, not a promise of a later date — and the pill keeps its casing
    // for the same reason the Learners one does: "DEPED" mangles the proper noun.
    const reason = screen.getAllByText(
      "End of Terms Reports — for DepEd teachers who advise a section"
    );
    expect(reason.length).toBeGreaterThan(0);
    expect(reason[0].className).toContain("sr-only");
    expect(screen.queryByText("Soon")).toBeNull();
    // Both gated rows carry the pill, so it renders twice in one sidebar.
    expect(screen.getAllByText("DepEd only").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("DepEd only")[0].className).not.toContain("uppercase");
  });

  it("keeps Learners for an ordinary teacher", () => {
    // The fail-open guarantee: with the options argument omitted entirely, the
    // role that OWNS the roster must still get a real link. Breaking this is worse
    // than showing a volunteer one extra row.
    renderTeacherSidebar();
    const link = screen.getAllByRole("link", { name: "Learners" })[0];
    expect(link.getAttribute("href")).toBe("/teacher/learners");
    // No `unavailable` key on the default path, so no inert treatment leaks in.
    expect(link.closest("[aria-disabled]")).toBeNull();
    expect(screen.queryByText("DepEd only")).toBeNull();
    expect(
      screen.queryByText("Learners — for DepEd teachers who advise a section")
    ).toBeNull();
  });

  it("keeps Learners for a teacher explicitly flagged not-a-volunteer", () => {
    // Separate from the omitted-prop case above because the two reach the config
    // by different values (undefined vs false) and the shell forwards the prop
    // verbatim. This is the case that catches an inverted or defaulted flag on
    // the way through the shell — e.g. `isAralVolunteer ?? true`.
    renderTeacherSidebar({ isAralVolunteer: false });
    expect(
      screen.getAllByRole("link", { name: "Learners" })[0].getAttribute("href")
    ).toBe("/teacher/learners");
    expect(screen.queryByText("DepEd only")).toBeNull();
  });
});

describe("AppSidebar — school head", () => {
  it("renders no section heading for single-group roles", () => {
    pathname.value = "/school-head";
    render(<AppSidebar role="SCHOOL_HEAD" userName="Head" expanded />);
    expect(screen.queryByText("Menu")).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Teachers" })[0].getAttribute("href")
    ).toBe("/school-head/teachers");
  });
});

describe("AppSidebar — click feedback while the destination loads", () => {
  beforeEach(() => {
    pathname.value = "/teacher";
  });

  /** Every rendered copy of the row for `href` (desktop rail, and the sheet if open). */
  function rowsFor(href: string): HTMLElement[] {
    return Array.from(
      document.querySelectorAll<HTMLElement>(`a[href="${href}"]`)
    );
  }

  it("shows nothing pending when no navigation is in flight", () => {
    renderTeacherSidebar();

    expect(document.querySelectorAll("[data-nav-pending]")).toHaveLength(0);
  });

  it("marks the navigating row, and only that row", () => {
    pendingHref.value = "/teacher/learners";
    renderTeacherSidebar();

    const learners = rowsFor("/teacher/learners");
    expect(learners.length).toBeGreaterThan(0);
    for (const row of learners) {
      expect(row.querySelector("[data-nav-pending]")).not.toBeNull();
    }

    // The point of the feature is that one row answers the click. If the flag
    // leaked to every row the sidebar would read as entirely busy, which is both
    // wrong and no more informative than the frozen sidebar it replaces.
    expect(document.querySelectorAll("[data-nav-pending]")).toHaveLength(
      learners.length
    );
    for (const row of rowsFor("/teacher")) {
      expect(row.querySelector("[data-nav-pending]")).toBeNull();
    }
  });

  it("keeps the row readable while it spins", () => {
    pendingHref.value = "/teacher/learners";
    renderTeacherSidebar();

    // The spinner replaces the icon, not the label: a row that lost its text
    // mid-navigation would be a worse answer than no feedback at all.
    const [row] = rowsFor("/teacher/learners");
    expect(row.textContent).toContain("Learners");
    expect(screen.getAllByRole("link", { name: "Learners" }).length).toBeGreaterThan(0);
  });

  it("does not announce the wait a second time", () => {
    pendingHref.value = "/teacher/learners";
    const { container } = renderTeacherSidebar();

    // The destination boundary announces it once it commits (BookLoader carries
    // `role="status"`). A live region here as well would report one navigation
    // twice, so the spinner is deliberately silent.
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
  });

  it("still marks the row on the collapsed rail, where the icon is the whole row", () => {
    pendingHref.value = "/teacher/learners";
    renderTeacherSidebar({ expanded: false });

    // Collapsed rows drop their label, so the icon swap is the only feedback
    // available — it has to survive the collapse.
    const rows = rowsFor("/teacher/learners");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.querySelector("[data-nav-pending]")).not.toBeNull();
    }
  });
});

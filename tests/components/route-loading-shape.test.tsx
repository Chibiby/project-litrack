/**
 * Guards the "two skeletons" regression.
 *
 * A route's `loading.tsx` is replaced by that page's own Suspense fallback, so
 * whenever the two draw different shapes the teacher sees one skeleton morph
 * into a second before the content lands. The rule this file enforces:
 *
 *  - a boundary that knows its route mirrors that page's first paint;
 *  - a boundary that cannot know its route draws nothing route-shaped.
 *
 * `/teacher/(app)/loading.tsx` is the second kind: it wraps the dashboard, the
 * roster, ARAL and reports alike, so a table skeleton there rendered a table on
 * top of the dashboard.
 *
 * The two ARAL grid routes are the first kind, and they are unusual in one
 * respect: their `loading.tsx` and their page's Suspense fallback render the
 * *same* prop-less preset. That makes the strongest check available — the two
 * subtrees must be identical HTML — and the last block below does exactly that.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { render, cleanup } from "@testing-library/react";
import TeacherLearnersLoading from "@/app/teacher/(app)/learners/loading";
import TeacherLoading from "@/app/teacher/(app)/loading";
import TeacherDashboardLoading from "@/app/teacher/(app)/(dashboard)/loading";
import TeacherAralAttendanceLoading from "@/app/teacher/(app)/aral/[gradeId]/attendance/loading";
import TeacherAralReadingLevelLoading from "@/app/teacher/(app)/aral/[gradeId]/reading-level/loading";
import TeacherAralTermsReportsLoading from "@/app/teacher/(app)/aral/[gradeId]/terms-reports/loading";
import TeacherTermsReportsLoading from "@/app/teacher/(app)/terms-reports/loading";
import SchoolHeadDashboardLoading from "@/app/school-head/(app)/loading";
import SchoolHeadTransferLoading from "@/app/school-head/(app)/transfer/loading";
import SchoolHeadAralLoading from "@/app/school-head/(app)/aral/loading";
import SchoolHeadAnnouncementsLoading from "@/app/school-head/(app)/announcements/loading";
import SchoolWorkspaceLoading from "@/app/school-head/(app)/school/loading";
import SchoolHeadTeachersLoading from "@/app/school-head/(app)/teachers/loading";
import SchoolHeadKinderChecklistLoading from "@/app/school-head/(app)/terms-reports/kinder/loading";
import SchoolHeadIpLearnersLoading from "@/app/school-head/(app)/ip-learners/loading";
import SchoolHeadAuditLoading from "@/app/school-head/(app)/audit/loading";
import SchoolHeadTermSubjectsLoading from "@/app/school-head/(app)/term-subjects/loading";
import SchoolHeadReportsLoading from "@/app/school-head/(app)/reports/loading";
import {
  SCHOOL_WORKSPACE_TABS,
  TEACHER_TABS,
} from "@/components/school-head/workspace-tabs";
import { AralAttendanceSkeleton, AralReadingLevelSkeleton } from "@/components/loading";
import { clearPendingPostLoginSplash } from "@/lib/post-login-flag";

afterEach(cleanup);
beforeEach(() => {
  // The bridge covers every fresh document; release it so the skeleton renders.
  clearPendingPostLoginSplash();
});

describe("teacher route loading boundaries", () => {
  it("the roster boundary mirrors the roster's first paint", () => {
    const { container } = render(<TeacherLearnersLoading />);

    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(4);
    expect(
      container.querySelector('[data-slot="roster-header-skeleton"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="table-skeleton"]')
    ).not.toBeNull();
  });

  it("the dashboard boundary mirrors the dashboard's first paint", () => {
    const { container } = render(<TeacherDashboardLoading />);

    // Same four cards the page's own Suspense fallback draws, and no table.
    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(4);
    expect(
      container.querySelectorAll('[data-slot="table-skeleton"]')
    ).toHaveLength(0);
  });

  it("the tree-wide boundary draws nothing route-shaped", () => {
    const { container } = render(<TeacherLoading />);

    expect(
      container.querySelectorAll('[data-slot="table-skeleton"]')
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(0);
  });
});

interface AralGridRoute {
  label: string;
  /** Folder under `src/app/teacher/(app)/aral/[gradeId]/`. */
  dir: string;
  /** The route's own `loading.tsx` default export — renders OUTSIDE `AppShell`. */
  Boundary: ComponentType;
  /** The preset that page hands Suspense — renders INSIDE `AppShell`'s `<main>`. */
  Fallback: ComponentType;
  /** Its exported name, for the one half of the pair only source text can see. */
  presetName: string;
  /** The pager. Attendance loads the whole ARAL roster for the grade, so it has none. */
  footer: boolean;
  /** Violet cards: two trailing on the grids, one leading lock note on the term sheet. */
  infoCards: number;
}

/**
 * Every ARAL grid route paired with the preset its `page.tsx` passes to
 * Suspense. Both halves come from `@/components/loading`; the point of the block
 * below is to make that sharing load-bearing rather than incidental, so an edit
 * that inlines or re-points one side fails here instead of shipping a skeleton
 * that morphs mid-load.
 */
const ARAL_GRID_ROUTES: AralGridRoute[] = [
  {
    label: "weekly attendance",
    dir: "attendance",
    Boundary: TeacherAralAttendanceLoading,
    Fallback: AralAttendanceSkeleton,
    presetName: "AralAttendanceSkeleton",
    footer: false,
    infoCards: 2,
  },
  {
    label: "monthly reading level",
    dir: "reading-level",
    Boundary: TeacherAralReadingLevelLoading,
    Fallback: AralReadingLevelSkeleton,
    presetName: "AralReadingLevelSkeleton",
    footer: true,
    infoCards: 2,
  },
];

const ARAL_ROUTE_DIR = path.resolve(
  __dirname,
  "../../src/app/teacher/(app)/aral/[gradeId]"
);

/** Any padding utility, responsive prefix included: `p-4`, `lg:p-6`, `pt-0`, … */
const PADDING_CLASS = /(?:^|:)p[trblxyse]?-/;

function paddingClassesOf(el: Element): string[] {
  return Array.from(el.classList).filter((c) => PADDING_CLASS.test(c));
}

/**
 * A boundary's outermost element — the one that owns the route's gutter.
 *
 * `RouteLoadingOverlay` wraps a boundary skeleton so it can position the
 * slow-load book animation over it, which displaces the skeleton root by exactly
 * one level. Step past that single wrapper — keyed to its own `data-slot`, not to
 * "whatever is on top" — so the gutter and `aria-busy` contracts below keep
 * asserting against the element that actually owns them.
 *
 * Keyed rather than generic on purpose. A helper that unwrapped any single child
 * would make every assertion below indifferent to nesting, and the padding
 * contract is precisely a claim about which element is outermost. Any *other*
 * stray wrapper must still fail these tests.
 */
function boundaryRootOf(container: HTMLElement): HTMLElement {
  let root = container.firstElementChild;
  if (
    root instanceof HTMLElement &&
    root.dataset.slot === "route-loading-overlay"
  ) {
    root = root.firstElementChild;
  }
  expect(root).toBeInstanceOf(HTMLElement);
  return root as HTMLElement;
}

/** The grid skeleton a boundary or a fallback draws. Exactly one, or this fails. */
function gridSkeletonOf(container: HTMLElement): HTMLElement {
  const found = container.querySelectorAll<HTMLElement>(
    '[data-slot="aral-grid-skeleton"]'
  );
  expect(found).toHaveLength(1);
  return found[0];
}

/**
 * Footer presence × info-card count. The two presets do not share that
 * pair, which is what makes a preset wired to the wrong route visible. Column
 * counts would discriminate too, but they churn on every visual tweak.
 */
function fingerprintOf(el: Element): string {
  const footers = el.querySelectorAll('[data-slot="aral-grid-footer"]').length;
  const cards = el.querySelectorAll('[data-slot="info-card-skeleton"]').length;
  return `footer=${footers} cards=${cards}`;
}

/** True when `a` comes before `b` in document order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
  );
}

describe("ARAL grid route loading boundaries", () => {
  for (const route of ARAL_GRID_ROUTES) {
    it(`the ${route.label} boundary draws the grid skeleton`, () => {
      const { container } = render(<route.Boundary />);
      const grid = gridSkeletonOf(container);

      // The grids carry their own table slot on purpose. `TableSectionSkeleton`
      // draws equal-width columns, which is the wrong shape here — and the
      // tree-wide test above asserts on exactly `table-skeleton` and
      // `stat-card-skeleton`, so borrowing those slots would quietly make that
      // test unfalsifiable for every ARAL route.
      expect(
        grid.querySelector('[data-slot="aral-grid-table"]')
      ).not.toBeNull();
      expect(
        container.querySelectorAll('[data-slot="table-skeleton"]')
      ).toHaveLength(0);
      expect(
        container.querySelectorAll('[data-slot="stat-card-skeleton"]')
      ).toHaveLength(0);
    });

    it(`the ${route.label} boundary and the page's fallback are one drawing`, () => {
      const boundary = render(<route.Boundary />);
      const fallback = render(<route.Fallback />);

      // Byte for byte, because the handover between the two is instantaneous and
      // anything short of identical reads as a second skeleton. A divergence
      // here means the shared preset import was broken on one of the two sides.
      expect(gridSkeletonOf(boundary.container).outerHTML).toBe(
        gridSkeletonOf(fallback.container).outerHTML
      );
    });

    it(`the ${route.label} boundary owns the gutter, the skeleton does not`, () => {
      const { container } = render(<route.Boundary />);

      // `loading.tsx` replaces the page whole, `AppShell` included, so it
      // supplies the gutter itself. The fallback instead lands inside
      // `AppShell`'s `<main className="w-full p-4 lg:p-6">`, so the skeleton
      // root must stay unpadded. Backwards, one of the two paths double-pads and
      // the grid visibly shifts as the boundary hands over.
      const root = boundaryRootOf(container);
      expect(root.classList.contains("p-4")).toBe(true);
      expect(root.classList.contains("lg:p-6")).toBe(true);
      expect(paddingClassesOf(gridSkeletonOf(container))).toEqual([]);
    });

    it(`the ${route.label} boundary draws that sheet's own structure`, () => {
      const grid = gridSkeletonOf(render(<route.Boundary />).container);

      expect(
        grid.querySelectorAll('[data-slot="aral-grid-footer"]')
      ).toHaveLength(route.footer ? 1 : 0);
      expect(
        grid.querySelectorAll('[data-slot="info-card-skeleton"]')
      ).toHaveLength(route.infoCards);
    });

    it(`the ${route.label} page hands Suspense that same preset`, () => {
      // The other half of the pair, checked as source text because it cannot be
      // checked at runtime: the page is an async server component whose body
      // runs `requireUser` and Prisma reads, so rendering it here to inspect its
      // fallback is not available. Without this, every test above would still
      // pass after someone re-pointed a page's `fallback` at a different preset
      // or inlined a one-off skeleton — the exact regression this file exists to
      // prevent, on the side the DOM cannot see.
      const source = readFileSync(
        path.join(ARAL_ROUTE_DIR, route.dir, "page.tsx"),
        "utf8"
      );

      expect(source).toMatch(
        new RegExp(`fallback=\\{\\s*<\\s*${route.presetName}\\s*/>\\s*\\}`)
      );
      // From the shared barrel, not a local redefinition of the same name.
      expect(source).toMatch(
        new RegExp(
          `import\\s*\\{[^}]*\\b${route.presetName}\\b[^}]*\\}\\s*from\\s*"@/components/loading"`
        )
      );
    });
  }

  it("the presets draw distinguishable shapes", () => {
    // The per-route expectations above only catch a swapped preset if no two
    // routes expect the same thing. Assert that here rather than trusting the
    // table to stay distinct.
    const shapes = ARAL_GRID_ROUTES.map((route) =>
      fingerprintOf(gridSkeletonOf(render(<route.Fallback />).container))
    );

    expect(new Set(shapes).size).toBe(ARAL_GRID_ROUTES.length);
  });
});

/**
 * The title block above the grid — the second half of the same handover.
 *
 * `loading.tsx` replaces the page whole, `AppShell` included, so it has to draw
 * the title row itself; without it the grid starts ~60px too high and drops the
 * moment the page streams its real `PageTitleBlock`. The page's Suspense
 * fallback sits *below* that real title block, so it must draw none — a second
 * one there would double the header instead.
 *
 * So the two exports are asymmetric on purpose, exactly like the padding
 * contract above: `*RouteSkeleton` owns the gutter AND the title block, the bare
 * preset owns neither. Both halves are asserted, because either one alone is
 * satisfied by the wrong component.
 *
 * Deliberately not asserted: the action-pill widths and counts. Those differ per
 * route by design and the widths are label-length estimates, so pinning them
 * would make this file churn on every copy change.
 */
describe("ARAL grid route title blocks", () => {
  for (const route of ARAL_GRID_ROUTES) {
    it(`the ${route.label} boundary draws one title block, above the grid`, () => {
      const { container } = render(<route.Boundary />);

      const titles = container.querySelectorAll<HTMLElement>(
        '[data-slot="aral-title-skeleton"]'
      );
      expect(titles).toHaveLength(1);

      // Order matters as much as presence: a title block after the grid would
      // satisfy a count-only check while still pushing the grid down on paint.
      expect(precedes(titles[0], gridSkeletonOf(container))).toBe(true);
    });

    it(`the ${route.label} title block keeps the margins that match PageTitleBlock`, () => {
      const { container } = render(<route.Boundary />);
      const title = container.querySelector<HTMLElement>(
        '[data-slot="aral-title-skeleton"]'
      );
      expect(title).not.toBeNull();

      // `mb-4` and `lg:mb-6` are what make this block's total height equal the
      // real title block's at BOTH breakpoints. Drop either and the grid lands on
      // a different row than the page will put it on, which is the jump this
      // whole arrangement exists to prevent — so these two are the exception to
      // "no Tailwind class assertions".
      expect(title!.classList.contains("mb-4")).toBe(true);
      expect(title!.classList.contains("lg:mb-6")).toBe(true);
    });

    it(`the ${route.label} page's own fallback draws no title block`, () => {
      const { container } = render(<route.Fallback />);

      // The mirror of the padding contract. This fallback renders below the real
      // `PageTitleBlock` inside `AppShell`, so a title skeleton here would paint
      // a second header under the first.
      expect(
        container.querySelectorAll('[data-slot="aral-title-skeleton"]')
      ).toHaveLength(0);
    });

    it(`the ${route.label} boundary announces itself to a screen reader`, () => {
      const { container } = render(<route.Boundary />);
      const root = boundaryRootOf(container);

      // Every visual piece below is `aria-hidden`, which is right — a shimmer
      // bar has nothing to say. But that makes the whole boundary silent unless
      // the root carries the busy state and something announces the wait, and
      // this boundary replaces the entire page.
      expect(root.getAttribute("aria-busy")).toBe("true");

      const srOnly = root.querySelector<HTMLElement>(".sr-only");
      expect(srOnly).not.toBeNull();
      expect(srOnly!.textContent?.trim()).not.toBe("");
      // Inside the announced region, not nested under an aria-hidden subtree.
      expect(srOnly!.closest("[aria-hidden]")).toBeNull();
    });
  }
});

/**
 * v2 End of Terms: the sheet left the ARAL grid family. Both of its URLs draw
 * the page's own banner-and-body skeleton, gutter and busy state included, so
 * a teacher on the v2 route and a Super Admin on the grade route see the same
 * handover.
 */
describe("End of Terms route loading boundaries", () => {
  for (const [label, Boundary] of [
    ["/teacher/terms-reports", TeacherTermsReportsLoading],
    ["/teacher/aral/[gradeId]/terms-reports", TeacherAralTermsReportsLoading],
  ] as const) {
    it(`${label} draws the gutter and announces the wait`, () => {
      const { container } = render(<Boundary />);
      const root = boundaryRootOf(container);
      expect(paddingClassesOf(root)).toEqual(["p-4", "lg:p-6"]);
      expect(root.getAttribute("aria-busy")).toBe("true");
      expect(root.querySelector(".sr-only")?.textContent).toBe("Loading end of terms reports");
    });
  }

  it("both pages hand Suspense the same body skeleton their boundaries draw", () => {
    for (const page of [
      "../../src/app/teacher/(app)/terms-reports/page.tsx",
      "../../src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx",
    ]) {
      const source = readFileSync(path.resolve(__dirname, page), "utf8");
      expect(source, page).toContain("fallback={<TermsReportBodySkeleton />}");
    }
  });
});

/**
 * School Head route boundaries: the same "two skeletons" contract as the
 * teacher tree above, guarding the regression directly named in the task that
 * created this block — `/school-head/transfer` grew a banded hero, but its
 * `loading.tsx` kept drawing the old compact title-and-description block, so
 * the boundary and the loaded page disagreed about the header shape and the
 * layout jumped on every hard navigation to that route. It has since been
 * fixed; these cases are what would have caught it.
 */
describe("School Head dashboard loading boundary", () => {
  it("draws six stat skeletons and no table", () => {
    const { container } = render(<SchoolHeadDashboardLoading />);

    // `dashboard-skeleton.tsx` marks each card `data-slot="stat-card-skeleton"`
    // for exactly this assertion. Six, not the teacher tree's four — and never
    // a table, because the dashboard's own Suspense fallback draws the same
    // six cards and nothing tabular.
    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(6);
    expect(
      container.querySelectorAll('[data-slot="table-skeleton"]')
    ).toHaveLength(0);
  });
});

interface SchoolHeadHeroRoute {
  label: string;
  Boundary: ComponentType;
  /** Tabs this route's own tab bar should draw; 0 for the untabbed routes. */
  tabs: number;
}

/**
 * Every School Head route whose page was converted to the banded hero, paired
 * with the `loading.tsx` that is supposed to mirror it. `audit`,
 * `term-subjects` and `reports` are deliberately absent here — they kept the
 * compact title block on purpose, and are asserted separately below.
 */
const SCHOOL_HEAD_HERO_ROUTES: SchoolHeadHeroRoute[] = [
  { label: "transfer", Boundary: SchoolHeadTransferLoading, tabs: 0 },
  { label: "aral", Boundary: SchoolHeadAralLoading, tabs: 0 },
  { label: "announcements", Boundary: SchoolHeadAnnouncementsLoading, tabs: 0 },
  {
    label: "school workspace",
    Boundary: SchoolWorkspaceLoading,
    tabs: SCHOOL_WORKSPACE_TABS.length,
  },
  {
    label: "teachers",
    Boundary: SchoolHeadTeachersLoading,
    tabs: Object.keys(TEACHER_TABS).length,
  },
  {
    label: "terms-reports/kinder",
    Boundary: SchoolHeadKinderChecklistLoading,
    tabs: 0,
  },
  { label: "ip-learners", Boundary: SchoolHeadIpLearnersLoading, tabs: 0 },
];

/**
 * The three routes that deliberately kept the compact title-and-description
 * block instead of the hero. Asserted as their own group, not merely left out
 * of the table above, so a hero wrongly added to one of these fails a test
 * too — guarding the operator's decision in both directions.
 */
const SCHOOL_HEAD_COMPACT_ROUTES: { label: string; Boundary: ComponentType }[] = [
  { label: "audit", Boundary: SchoolHeadAuditLoading },
  { label: "term-subjects", Boundary: SchoolHeadTermSubjectsLoading },
  { label: "reports", Boundary: SchoolHeadReportsLoading },
];

/**
 * `SchoolHeadPageSkeleton` draws exactly one of two things right after its
 * sr-only label: the hero variant is a single unpadded `Skeleton` leaf (zero
 * element children of its own); the compact variant is a wrapper `div` around
 * a title-text-and-description-text pair of `Skeleton`s (two element
 * children). Neither carries a `data-slot` — that marker is spent on
 * `stat-card-skeleton` and `table-skeleton` elsewhere — so the two are told
 * apart the only way the DOM itself tells them apart: child-element count.
 */
function heroOrTitleNodeOf(container: HTMLElement): HTMLElement {
  const root = boundaryRootOf(container);
  const srOnly = root.querySelector(".sr-only");
  expect(srOnly).not.toBeNull();
  const node = srOnly!.nextElementSibling;
  expect(node).toBeInstanceOf(HTMLElement);
  return node as HTMLElement;
}

/**
 * `SchoolHeadPageSkeleton`'s tab bar is the only block in this skeleton
 * styled with `border-border/70` — every content skeleton's own row and
 * header dividers use `/60` or `/40` (`table-section-skeleton.tsx`,
 * `list-card-skeleton.tsx`) — so that value alone, not document position,
 * is what picks the tab bar out from whatever content follows it.
 */
function tabSkeletonCountOf(container: HTMLElement): number {
  const root = boundaryRootOf(container);
  const tabBar = root.querySelector<HTMLElement>('[class*="border-border/70"]');
  return tabBar ? tabBar.children.length : 0;
}

describe("School Head hero route loading boundaries", () => {
  for (const route of SCHOOL_HEAD_HERO_ROUTES) {
    it(`the ${route.label} boundary draws the banded hero, not the compact title block`, () => {
      const { container } = render(<route.Boundary />);
      expect(heroOrTitleNodeOf(container).children).toHaveLength(0);
    });
  }

  it("the teachers boundary draws its own five tabs", () => {
    const { container } = render(<SchoolHeadTeachersLoading />);
    expect(tabSkeletonCountOf(container)).toBe(5);
  });

  it("the school workspace boundary draws its own three tabs", () => {
    const { container } = render(<SchoolWorkspaceLoading />);
    expect(tabSkeletonCountOf(container)).toBe(3);
  });

  it("the untabbed hero routes draw no tab bar", () => {
    for (const route of SCHOOL_HEAD_HERO_ROUTES.filter((r) => r.tabs === 0)) {
      const { container } = render(<route.Boundary />);
      expect(tabSkeletonCountOf(container)).toBe(0);
    }
  });
});

describe("School Head compact route loading boundaries", () => {
  for (const route of SCHOOL_HEAD_COMPACT_ROUTES) {
    it(`the ${route.label} boundary keeps the compact title block, not a hero`, () => {
      const { container } = render(<route.Boundary />);
      // Two children: the title-text `Skeleton` and the description-text
      // `Skeleton` this route's page still renders instead of a hero.
      expect(heroOrTitleNodeOf(container).children).toHaveLength(2);
    });
  }
});

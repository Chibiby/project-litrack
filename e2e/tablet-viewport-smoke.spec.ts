import { test, expect, type Page } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * Tablet smoke coverage: at two common tablet viewports (768x1024 portrait,
 * 1024x768 landscape) the teacher dashboard, ARAL weekly attendance grid, and
 * learner list must not overflow horizontally, and every visible button must
 * meet a 44px minimum tap-target height below 1024px width (WCAG 2.5.5-ish;
 * matches the `h-11`/`sm:h-9` responsive pattern already used across the
 * teacher UI, e.g. `AralWeeklyAttendancePanel`).
 *
 * Opt-in — start `npm run dev` yourself or set `PLAYWRIGHT_BASE_URL`. Never
 * point it at production; see `e2e/helpers/e2e-env.ts`.
 *
 * Required env vars:
 *   - LITRACK_E2E_ARAL_GRADE_ID   a GradeLevel id reachable at
 *     /teacher/aral/<id>/attendance for the "teacher" persona (same one used
 *     by `aral-weekly-attendance.spec.ts`; read-only here, nothing is saved).
 *
 * Requires a saved "teacher" persona session — see
 * `e2e/auth/login.mjs` + `node e2e/auth/persona.mjs teacher`.
 */

const VIEWPORTS = [
  { width: 768, height: 1024, label: "768x1024 portrait" },
  { width: 1024, height: 768, label: "1024x768 landscape" },
];

const MIN_TAP_TARGET_PX = 44;

async function assertNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    `documentElement.scrollWidth (${overflow.scrollWidth}) must not exceed innerWidth (${overflow.innerWidth})`
  ).toBeLessThanOrEqual(overflow.innerWidth);
}

async function assertTapTargets(page: Page, viewportWidth: number) {
  if (viewportWidth >= 1024) return; // requirement only applies below 1024px width
  const heights = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { height: rect.height, label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 60) };
      });
  });

  const tooSmall = heights.filter((b) => b.height < MIN_TAP_TARGET_PX);
  expect(
    tooSmall,
    `buttons under ${MIN_TAP_TARGET_PX}px tall at width < 1024: ${JSON.stringify(tooSmall)}`
  ).toEqual([]);
}

test.beforeAll(() => {
  assertNotProduction();
});

test.describe("tablet viewport smoke", () => {
  test.use({
    storageState: hasPersonaSession("teacher") ? personaStatePath("teacher") : undefined,
  });

  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  for (const viewport of VIEWPORTS) {
    test.describe(viewport.label, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test("teacher dashboard has no horizontal overflow and tappable buttons", async ({
        page,
      }) => {
        const reason = skipReason({ persona: "teacher" });
        test.skip(!!reason, reason ?? "");

        await page.goto("/teacher");
        await page.waitForLoadState("networkidle");
        await assertNoHorizontalOverflow(page);
        await assertTapTargets(page, viewport.width);
      });

      test("learner list has no horizontal overflow and tappable buttons", async ({ page }) => {
        const reason = skipReason({ persona: "teacher" });
        test.skip(!!reason, reason ?? "");

        await page.goto("/teacher/learners");
        await page.waitForLoadState("networkidle");
        await assertNoHorizontalOverflow(page);
        await assertTapTargets(page, viewport.width);
      });

      test("ARAL weekly attendance grid has no horizontal overflow and tappable buttons", async ({
        page,
      }) => {
        const reason = skipReason({
          envNames: ["LITRACK_E2E_ARAL_GRADE_ID"],
          persona: "teacher",
        });
        test.skip(!!reason, reason ?? "");

        const gradeId = process.env.LITRACK_E2E_ARAL_GRADE_ID!;
        await page.goto(`/teacher/aral/${gradeId}/attendance`);
        await page.waitForLoadState("networkidle");
        // The grid's own table scrolls horizontally by design
        // (`overflow-x-auto` in `aral-weekly-attendance-grid-form.tsx`) — that
        // is a scrollable child, not page overflow, so only the page-level
        // scrollWidth is asserted here.
        await assertNoHorizontalOverflow(page);
        await assertTapTargets(page, viewport.width);
      });
    });
  }
});

import { test, expect } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * ARAL weekly attendance grid: set a cell to Present, save, reload, and
 * confirm the mark survived the round trip through the server action and
 * back out of the database.
 *
 * Opt-in — start `npm run dev` yourself or set `PLAYWRIGHT_BASE_URL`. Never
 * point it at production; see `e2e/helpers/e2e-env.ts`.
 *
 * This test WRITES a real Attendance row for whatever grade/learner it is
 * pointed at — use a disposable grade in seeded/demo data, not a
 * production-shaped roster you care about.
 *
 * Required env vars:
 *   - LITRACK_E2E_ARAL_GRADE_ID   a GradeLevel id the "teacher" persona may
 *     open at /teacher/aral/<id>/attendance, with at least one ARAL learner
 *     enrolled (the grid must have at least one row to set a cell on).
 *
 * Requires a saved "teacher" persona session — see
 * `e2e/auth/login.mjs` + `node e2e/auth/persona.mjs teacher`.
 */

test.beforeAll(() => {
  assertNotProduction();
});

test.describe("ARAL weekly attendance grid persistence", () => {
  test.use({
    storageState: hasPersonaSession("teacher") ? personaStatePath("teacher") : undefined,
  });

  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  test.beforeEach(async ({ page }) => {
    const reason = skipReason({
      envNames: ["LITRACK_E2E_ARAL_GRADE_ID"],
      persona: "teacher",
    });
    test.skip(!!reason, reason ?? "");

    const gradeId = process.env.LITRACK_E2E_ARAL_GRADE_ID!;
    await page.goto(`/teacher/aral/${gradeId}/attendance`);
  });

  test("marking a day Present survives a save and a reload", async ({ page }) => {
    const cell = page.getByRole("button", { name: /attendance for/i }).first();
    test.skip((await cell.count()) === 0, "grid has no ARAL learner rows to mark");

    await expect(cell).toBeVisible();
    const label = await cell.getAttribute("aria-label");

    await cell.click();
    await page.getByRole("button", { name: "Present", exact: true }).click();
    // Present takes no reason, so the popover closes itself and the cell now
    // reads "P" — confirm client state changed before saving it.
    await expect(cell).toContainText("P");

    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Weekly attendance saved")).toBeVisible({ timeout: 15_000 });

    await page.reload();
    const reloadedCell = page.getByRole("button", { name: label ?? /attendance for/i }).first();
    await expect(reloadedCell).toBeVisible();
    await expect(reloadedCell).toContainText("P");
  });
});

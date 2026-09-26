import path from "node:path";
import { test, expect } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * Learner CSV import: upload a small fixture, confirm the preview reports
 * rows correctly, commit, and confirm imported learners show up. A second
 * fixture mixes a valid row with malformed ones to check the "not
 * all-or-nothing" partial-commit behaviour and error reporting
 * (`src/lib/learners/import-csv.ts`).
 *
 * Opt-in — start `npm run dev` yourself or set `PLAYWRIGHT_BASE_URL`. Never
 * point it at production; see `e2e/helpers/e2e-env.ts`.
 *
 * This test WRITES real Learner rows into whatever grade it is pointed at —
 * use a disposable grade in seeded/demo data.
 *
 * Required env vars:
 *   - LITRACK_E2E_IMPORT_GRADE_ID   a GradeLevel id the "teacher" persona
 *     advises (adviser-only page — see `teacherAdvisoryGradeScope`), ideally
 *     Grade 3 or above so the fixture's `englishReadingProfile` column
 *     applies (Grade 1/2 drop that column; the fixture would still import,
 *     just with that cell ignored).
 *
 * Requires a saved "teacher" persona session — see
 * `e2e/auth/login.mjs` + `node e2e/auth/persona.mjs teacher`.
 */

const VALID_CSV = path.join(__dirname, "fixtures", "learner-import-valid.csv");
const MIXED_CSV = path.join(__dirname, "fixtures", "learner-import-mixed.csv");

test.beforeAll(() => {
  assertNotProduction();
});

test.describe("learner CSV import", () => {
  test.use({
    storageState: hasPersonaSession("teacher") ? personaStatePath("teacher") : undefined,
  });

  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  test.beforeEach(async ({ page }) => {
    const reason = skipReason({
      envNames: ["LITRACK_E2E_IMPORT_GRADE_ID"],
      persona: "teacher",
    });
    test.skip(!!reason, reason ?? "");

    const gradeId = process.env.LITRACK_E2E_IMPORT_GRADE_ID!;
    await page.goto(`/teacher/grade/${gradeId}/import`);
  });

  test("a valid CSV previews and commits both rows", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(VALID_CSV);

    await expect(page.getByText(/2 valid/)).toBeVisible();
    await expect(page.getByText(/0 invalid/)).toBeVisible();
    await expect(page.getByText("E2E Import Alpha", { exact: false })).toBeVisible();
    await expect(page.getByText("E2E Import Bravo", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /import|commit/i }).click();
    await expect(page.getByText(/imported/i)).toBeVisible({ timeout: 15_000 });
  });

  test("a mixed CSV reports invalid rows and imports only the valid one", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(MIXED_CSV);

    await expect(page.getByText(/1 valid/)).toBeVisible();
    await expect(page.getByText(/2 invalid/)).toBeVisible();
    // The two bad rows (unknown gender enum, missing age) must be named as
    // errors, not silently dropped or silently accepted.
    await expect(page.getByText("E2E Mixed BadGender", { exact: false })).toBeVisible();
    await expect(page.getByText("E2E Mixed NoAge", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: /import|commit/i }).click();
    await expect(page.getByText(/imported/i)).toBeVisible({ timeout: 15_000 });
    // Partial commit: exactly the one valid row lands, the malformed two do not.
    await expect(page.getByText(/1 imported/i).or(page.getByText(/imported.*1/i))).toBeVisible();
  });
});

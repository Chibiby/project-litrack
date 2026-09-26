import { test, expect } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * Tenant isolation is the highest-severity bug class in LITRACK (see
 * CLAUDE.md § Tenancy): a School Head, Teacher, or District Admin reaching
 * another tenant's rows. These specs assert the negative — that a
 * cross-tenant id 404s instead of rendering data — using ids supplied via
 * env because there is no safe way to discover "a learner in some other
 * school" from inside a single tenant's own session.
 *
 * Opt-in like every other spec here: start `npm run dev` yourself or set
 * `PLAYWRIGHT_BASE_URL`. Never point it at production — see
 * `e2e/helpers/e2e-env.ts`.
 *
 * Required env vars (all optional per-test; each test skips on its own if
 * its inputs are missing):
 *   - LITRACK_E2E_OTHER_SCHOOL_GRADE_ID   a GradeLevel id belonging to a
 *     DIFFERENT school than the "teacher" persona session.
 *   - LITRACK_E2E_OTHER_SCHOOL_LEARNER_ID a Learner id inside that other
 *     school's grade above (same school, any grade — used with its own
 *     grade id, see the per-test note).
 *   - LITRACK_E2E_OTHER_SCHOOL_LEARNER_GRADE_ID the grade id that the
 *     learner above actually belongs to (may equal
 *     LITRACK_E2E_OTHER_SCHOOL_GRADE_ID if convenient).
 *   - LITRACK_E2E_OTHER_SCHOOL_ID          a School id different from the
 *     "head" persona session's own school — used to prove a School Head's
 *     own pages ignore a foreign `?schoolId=` rather than honoring it.
 *   - LITRACK_E2E_OUTSIDE_DISTRICT_SCHOOL_ID a School id outside the
 *     "district" persona's district/division scope.
 *
 * Persona sessions come from `e2e/auth/login.mjs` + `e2e/auth/persona.mjs`
 * (`teacher`, `head`, `district`). Without a saved session file the relevant
 * test skips — it does not fall back to an unauthenticated request, because
 * an unauthenticated redirect to /login would look like a false-positive
 * "not found".
 */

test.beforeAll(() => {
  assertNotProduction();
});

test.describe("tenancy isolation", () => {
  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  test.describe("teacher cannot reach another school's learner", () => {
    test.use({
      storageState: hasPersonaSession("teacher") ? personaStatePath("teacher") : undefined,
    });

    test("grade+learner id from another school 404s, not a redirect to data", async ({ page }) => {
      const reason = skipReason({
        envNames: [
          "LITRACK_E2E_OTHER_SCHOOL_LEARNER_GRADE_ID",
          "LITRACK_E2E_OTHER_SCHOOL_LEARNER_ID",
        ],
        persona: "teacher",
      });
      test.skip(!!reason, reason ?? "");

      const gradeId = process.env.LITRACK_E2E_OTHER_SCHOOL_LEARNER_GRADE_ID!;
      const learnerId = process.env.LITRACK_E2E_OTHER_SCHOOL_LEARNER_ID!;

      const response = await page.goto(`/teacher/grade/${gradeId}/learners/${learnerId}`);
      expect(response?.status()).toBe(404);
      // The 404 boundary, not the learner detail page's own content.
      await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
      await expect(page.getByText("Section A — Profile")).toHaveCount(0);
    });

    test("another school's ARAL grade weekly attendance grid 404s", async ({ page }) => {
      const reason = skipReason({
        envNames: ["LITRACK_E2E_OTHER_SCHOOL_GRADE_ID"],
        persona: "teacher",
      });
      test.skip(!!reason, reason ?? "");

      const gradeId = process.env.LITRACK_E2E_OTHER_SCHOOL_GRADE_ID!;
      const response = await page.goto(`/teacher/aral/${gradeId}/attendance`);
      expect(response?.status()).toBe(404);
      await expect(page.getByText(/Weekly Attendance —/)).toHaveCount(0);
    });
  });

  test.describe("school head cannot be steered to another school via ?schoolId=", () => {
    test.use({
      storageState: hasPersonaSession("head") ? personaStatePath("head") : undefined,
    });

    test("a foreign ?schoolId= on the School Head's own dashboard is ignored, not honored", async ({
      page,
    }) => {
      const reason = skipReason({
        envNames: ["LITRACK_E2E_OTHER_SCHOOL_ID"],
        persona: "head",
      });
      test.skip(!!reason, reason ?? "");

      const foreignSchoolId = process.env.LITRACK_E2E_OTHER_SCHOOL_ID!;
      const response = await page.goto(`/school-head?schoolId=${foreignSchoolId}`);
      // `resolveSchoolContext` only honors `?schoolId=` for SUPER_ADMIN — a real
      // School Head keeps seeing their own school and the page still loads.
      expect(response?.status()).toBeLessThan(400);
      await expect(page.getByText("(Admin View)")).toHaveCount(0);
    });
  });

  test.describe("district admin cannot open a school outside their district", () => {
    test.use({
      storageState: hasPersonaSession("district") ? personaStatePath("district") : undefined,
    });

    test("an out-of-scope school id 404s, not the school's dashboard", async ({ page }) => {
      const reason = skipReason({
        envNames: ["LITRACK_E2E_OUTSIDE_DISTRICT_SCHOOL_ID"],
        persona: "district",
      });
      test.skip(!!reason, reason ?? "");

      const schoolId = process.env.LITRACK_E2E_OUTSIDE_DISTRICT_SCHOOL_ID!;
      const response = await page.goto(`/district/schools/${schoolId}`);
      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
      await expect(page.getByText("School details")).toHaveCount(0);
    });
  });
});

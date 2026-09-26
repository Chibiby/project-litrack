import { test, expect } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * Learner transfer within a school: the School Head's Transfer page
 * (`/school-head/transfer`), searching for a learner and moving them to
 * Floating (no grade/section/teacher) — the one destination the form
 * supports without also needing a target teacher id from env.
 *
 * Opt-in — start `npm run dev` yourself or set `PLAYWRIGHT_BASE_URL`. Never
 * point it at production; see `e2e/helpers/e2e-env.ts`.
 *
 * This test WRITES a real transfer (`transferLearner` in
 * `src/lib/actions/enrollment.ts`) for whichever learner matches the search
 * query — use a disposable learner in seeded/demo data, not one anybody is
 * tracking. Floating keeps the learner's records and ARAL designation, so
 * the mutation is non-destructive, but it is not automatically reverted.
 *
 * Required env vars:
 *   - LITRACK_E2E_TRANSFER_LEARNER_QUERY   a search string (name substring)
 *     that resolves to exactly the one disposable test learner, via the
 *     same `searchActiveLearners` action the School Head UI calls.
 *
 * Requires a saved "head" persona session — see
 * `e2e/auth/login.mjs` + `node e2e/auth/persona.mjs head`.
 */

test.beforeAll(() => {
  assertNotProduction();
});

test.describe("learner transfer within school", () => {
  test.use({
    storageState: hasPersonaSession("head") ? personaStatePath("head") : undefined,
  });

  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  test.beforeEach(async ({ page }) => {
    const reason = skipReason({
      envNames: ["LITRACK_E2E_TRANSFER_LEARNER_QUERY"],
      persona: "head",
    });
    test.skip(!!reason, reason ?? "");

    await page.goto("/school-head/transfer");
  });

  test("moving a learner to Floating updates their record", async ({ page }) => {
    const query = process.env.LITRACK_E2E_TRANSFER_LEARNER_QUERY!;

    const noLearners = page.getByText("No learners to transfer");
    test.skip((await noLearners.count()) > 0, "target school has no learners to transfer");

    const searchInput = page.getByLabel("Learner");
    await searchInput.fill(query);

    const option = page.getByRole("option").first();
    await expect(option).toBeVisible({ timeout: 10_000 });
    const learnerLabel = (await option.innerText()).trim();
    await option.click();

    await expect(page.getByText(learnerLabel.split(" (")[0], { exact: false })).toBeVisible();

    await page.getByLabel("Target grade").selectOption({
      label: "Floating — no grade or section",
    });

    await page.getByRole("button", { name: "Move to Floating" }).click();
    await page.getByRole("button", { name: "Move", exact: true }).click();

    await expect(page.getByText("Learner moved to Floating")).toBeVisible({ timeout: 15_000 });
  });
});

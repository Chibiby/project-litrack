import { test, expect } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * Offline behaviour of the error-handling overhaul: a sign-in or save attempted
 * with no connection says "No internet connection", keeps what was typed, and a
 * bar at the bottom of the screen says "You're offline" until the connection
 * returns.
 *
 * Opt-in, like the other specs: start `npm run dev` against a NON-production
 * database yourself, or set PLAYWRIGHT_BASE_URL. Never point it at production.
 * Nothing here needs real credentials for case (a): the offline check runs in
 * the browser before any request is sent, so no sign-in ever reaches a server.
 *
 * Case (b) needs a saved "teacher" persona session and LITRACK_E2E_ARAL_GRADE_ID
 * (see aral-weekly-attendance.spec.ts). It edits a grid cell but never saves it
 * successfully: the save is attempted offline.
 */

test.beforeAll(() => {
  assertNotProduction();
});

const OFFLINE_MESSAGE = /No internet connection/;
const BANNER_TEXT = /You.re offline/;

test.describe("offline sign-in", () => {
  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  test("shows the offline message, keeps the typed email, and toggles the banner", async ({
    page,
    context,
  }) => {
    await page.goto("/login");

    const empty = page.getByText("No schools found. Contact admin.");
    test.skip((await empty.count()) > 0, "target database has no schools — run db:seed first");

    await page.getByLabel("School Name").click();
    await page.getByRole("option").first().click();

    const teachers = page.getByRole("button", { name: "Teachers" });
    test.skip(
      await teachers.isDisabled(),
      "the first school is not open to teachers yet, so the teacher form cannot be reached"
    );
    await teachers.click();
    await page.getByRole("button", { name: /Next: enter email and password/ }).click();

    const email = page.locator("#email");
    await expect(email).toBeVisible();
    const typed = "offline.check@example.invalid";
    await email.fill(typed);
    await page.locator("#teacherPassword").fill("not-a-real-password-1");

    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);

    await context.setOffline(true);
    await expect(page.getByText(BANNER_TEXT)).toBeVisible();

    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();

    await expect(page.getByText(OFFLINE_MESSAGE).first()).toBeVisible();
    // Still on the teacher form, with the typed value intact.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Teacher sign in" })).toBeVisible();
    await expect(email).toHaveValue(typed);
    await expect(page.getByText(BANNER_TEXT)).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
  });
});

test.describe("offline save in the teacher app", () => {
  test.use({
    storageState: hasPersonaSession("teacher") ? personaStatePath("teacher") : undefined,
  });

  test.beforeAll(async () => {
    const ok = await shouldRunAgainstServer();
    test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
  });

  test("a save attempted offline shows the message and keeps the edit", async ({ page, context }) => {
    const reason = skipReason({ envNames: ["LITRACK_E2E_ARAL_GRADE_ID"], persona: "teacher" });
    test.skip(!!reason, reason ?? "");

    const gradeId = process.env.LITRACK_E2E_ARAL_GRADE_ID!;
    await page.goto(`/teacher/aral/${gradeId}/attendance`);

    const cell = page.getByRole("button", { name: /attendance for/i }).first();
    test.skip((await cell.count()) === 0, "grid has no ARAL learner rows to mark");

    await cell.click();
    await page.getByRole("button", { name: "Present", exact: true }).click();
    await expect(cell).toContainText("P");

    await context.setOffline(true);
    await expect(page.getByText(BANNER_TEXT)).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText(OFFLINE_MESSAGE).first()).toBeVisible();
    await expect(page.getByText("Weekly attendance saved")).toHaveCount(0);
    // The unsaved mark is still on screen; nothing was thrown away.
    await expect(cell).toContainText("P");

    await context.setOffline(false);
    await expect(page.getByText(BANNER_TEXT)).toHaveCount(0);
  });
});

import { test, expect } from "@playwright/test";

/**
 * Smoke: /login renders. Locally, skips when the app server is unreachable
 * (no local DB / env). In CI, the same condition fails the test.
 */
test.describe("login page", () => {
  test("renders PROJECT LITRACK and role entry points", async ({ page }) => {
    try {
      const response = await page.goto("/login", { waitUntil: "domcontentloaded", timeout: 15_000 });
      if (!response || response.status() >= 500) {
        if (process.env.CI) {
          throw new Error(
            `App server unavailable or misconfigured (status ${response?.status() ?? "none"})`
          );
        }
        test.skip(true, "App server unavailable or misconfigured — skipping smoke test");
        return;
      }
    } catch (err) {
      if (process.env.CI) throw err;
      test.skip(true, "App server unreachable — skipping smoke test");
      return;
    }

    await expect(page.getByRole("heading", { name: /PROJECT LITRACK/i })).toBeVisible();
    await expect(page.getByText(/Super Admin/i)).toBeVisible();
  });
});

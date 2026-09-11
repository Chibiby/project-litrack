import { test, expect } from "@playwright/test";

/**
 * Unknown URLs must reach a 404 rather than a blank page or a redirect loop —
 * including inside a role area, where the layout authenticates first and the
 * catch-all only renders afterwards.
 *
 * Opt-in like the other specs: `playwright.config.ts` has no `webServer`, so
 * start `npm run dev` yourself or set PLAYWRIGHT_BASE_URL. Never point it at
 * production.
 */

test("an unknown public URL renders the 404 page", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /page not found/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
});

test("an unknown role URL sends a signed-out visitor to sign in first", async ({ page }) => {
  await page.goto("/teacher/does-not-exist");
  await expect(page).toHaveURL(/\/login/);
});

test("the forbidden page explains itself", async ({ page }) => {
  await page.goto("/forbidden");
  await expect(page.getByRole("heading", { name: /don't have access/i })).toBeVisible();
});

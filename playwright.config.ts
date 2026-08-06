import { defineConfig, devices } from "@playwright/test";

/**
 * E2E is opt-in: the app needs real Supabase env (and usually a live DB) to be
 * useful, so we do NOT auto-start `next dev` via webServer. Set PLAYWRIGHT_BASE_URL
 * (or run a local server at the default) and invoke `npm run test:e2e` manually.
 * Do not point this suite at production.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});

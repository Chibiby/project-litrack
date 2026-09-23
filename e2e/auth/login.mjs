// Saves a Super Admin browser session for local Playwright checks.
//
// Run it yourself, once, whenever the saved session has expired:
//
//   node e2e/auth/login.mjs
//
// It reads LITRACK_E2E_USER and LITRACK_E2E_PASS from `.env.e2e` at the repo
// root (gitignored by the `.env*` rule), signs in at /admin/login, and writes
// the session to `e2e/.auth/super-admin.json` (also gitignored). Tooling that
// needs a School Head or Teacher then derives one from that file through Page
// Test Lab (`e2e/auth/persona.mjs`) without ever handling the password.
//
// Local only: it refuses any base URL that is not localhost unless
// LITRACK_E2E_ALLOW_REMOTE=1, and it must never point at production.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { AUTH_DIR, SUPER_ADMIN_STATE, loadE2eEnv, resolveBaseUrl } from "./shared.mjs";

const env = loadE2eEnv();
const user = env.LITRACK_E2E_USER;
const pass = env.LITRACK_E2E_PASS;
if (!user || !pass) {
  console.error("Set LITRACK_E2E_USER and LITRACK_E2E_PASS in .env.e2e at the repo root.");
  process.exit(1);
}
const base = resolveBaseUrl(env);

fs.mkdirSync(AUTH_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/admin/login`, { waitUntil: "networkidle", timeout: 180_000 });
  // The form is a React client form. Typed before hydration, the values are
  // wiped and the click falls through to a native GET submit that never signs
  // in, which is what `next dev`'s slow first compile made happen. Wait until
  // React owns the input before touching it.
  const username = page.locator('input[name="username"]');
  await username.waitFor({ state: "visible", timeout: 180_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('input[name="username"]');
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps$")) && !el.disabled;
    },
    undefined,
    { timeout: 180_000 },
  );
  await username.fill(user);
  await page.locator('input[name="password"]').fill(pass);
  await page.locator('button[type="submit"]').click();
  try {
    await page.waitForURL((url) => url.pathname.startsWith("/admin") && !url.pathname.startsWith("/admin/login"), {
      timeout: 120_000,
    });
  } catch {
    const messages = await page
      .locator('[role="alert"], [data-sonner-toast], p[id$="-form-item-message"]')
      .allInnerTexts()
      .catch(() => []);
    const at = new URL(page.url());
    console.error(`Sign-in did not reach /admin. Still at ${at.origin}${at.pathname}.`);
    console.error(messages.map((m) => m.trim()).filter(Boolean).join("\n") || "(no error message on the page)");
    process.exit(1);
  }
  if (page.url().includes("/account/set-password")) {
    console.error("This account must set a new password first. Sign in by hand once, then re-run.");
    process.exit(1);
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  await ctx.storageState({ path: SUPER_ADMIN_STATE });
  console.log(`Saved Super Admin session to ${SUPER_ADMIN_STATE}`);
} finally {
  await browser.close();
}

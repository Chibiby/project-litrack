// Derives a demo persona session from the saved Super Admin session through
// Page Test Lab — no password involved.
//
//   node e2e/auth/persona.mjs head       -> e2e/.auth/head.json
//   node e2e/auth/persona.mjs teacher    -> e2e/.auth/teacher.json
//
// The persona session rides an impersonation ticket that lasts two hours, so
// re-run this before each check rather than reusing an old file. It also
// writes the Super Admin session back after loading a page, so the rotated
// Supabase refresh token is kept and the saved login stays valid.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import { SUPER_ADMIN_STATE, loadE2eEnv, personaStatePath, resolveBaseUrl } from "./shared.mjs";

const LABELS = {
  head: "Open as School Head",
  teacher: "Open as Teacher",
  "pending-teacher": "Open as Pending Teacher",
};
const DESTINATIONS = { head: /\/school-head/, teacher: /\/teacher/, "pending-teacher": /\/pending-approval|\/teacher/ };

const persona = process.argv[2] ?? "head";
if (!LABELS[persona]) {
  console.error(`Unknown persona "${persona}". Use one of: ${Object.keys(LABELS).join(", ")}`);
  process.exit(1);
}
if (!fs.existsSync(SUPER_ADMIN_STATE)) {
  console.error("No saved Super Admin session. Run `node e2e/auth/login.mjs` first.");
  process.exit(2);
}
const base = resolveBaseUrl(loadE2eEnv());

const browser = await chromium.launch();
try {
  // 1. Refresh and persist the admin session on its own, before any swap.
  const adminCtx = await browser.newContext({ storageState: SUPER_ADMIN_STATE });
  const adminPage = await adminCtx.newPage();
  await adminPage.goto(`${base}/admin/test-lab`, { waitUntil: "networkidle", timeout: 180_000 });
  if (!new URL(adminPage.url()).pathname.startsWith("/admin/test-lab")) {
    console.error(`Saved Super Admin session has expired (landed on ${adminPage.url()}). Run \`node e2e/auth/login.mjs\`.`);
    process.exit(2);
  }
  await adminCtx.storageState({ path: SUPER_ADMIN_STATE });
  await adminCtx.close();

  // 2. Swap into the persona in a separate context, so the admin file above is untouched.
  const ctx = await browser.newContext({ storageState: SUPER_ADMIN_STATE });
  const page = await ctx.newPage();
  await page.goto(`${base}/admin/test-lab`, { waitUntil: "networkidle", timeout: 180_000 });
  // Clicking a client button before hydration does nothing. Wait until React
  // owns the page's buttons, then clear the first-visit tour dialog if it shows.
  await page.waitForFunction(
    () => [...document.querySelectorAll("main button")].some((b) => Object.keys(b).some((k) => k.startsWith("__reactProps$"))),
    undefined,
    { timeout: 180_000 },
  );
  // A modal marks the rest of the page hidden, so no persona button is found
  // behind it: the first-visit tour, and the "System updated" notice after a
  // release. The notice waits out the post-login splash (up to ~10s) first,
  // so keep checking until the persona button itself is reachable.
  const target = page.getByRole("button", { name: LABELS[persona] });
  const openDemoProbe = page.getByRole("button", { name: /open demo session/i });
  for (let i = 0; i < 24; i++) {
    for (const name of [/^explore later$/i, /^got it$/i]) {
      const dismiss = page.getByRole("button", { name });
      if (await dismiss.isVisible().catch(() => false)) await dismiss.click().catch(() => {});
    }
    if (i >= 4 && ((await target.isVisible().catch(() => false)) || (await openDemoProbe.isVisible().catch(() => false)))) break;
    await page.waitForTimeout(500);
  }
  const openDemo = page.getByRole("button", { name: /open demo session/i });
  if (await openDemo.isVisible().catch(() => false)) {
    await openDemo.click();
    await page.waitForLoadState("networkidle");
  }
  const start = page.getByRole("button", { name: LABELS[persona] });
  await start.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  // Prepare writes fixtures into the demo school only, and is idempotent.
  if (!(await start.isVisible().catch(() => false))) {
    const prepare = page.getByRole("button", { name: /^prepare test data$/i });
    if (await prepare.isVisible().catch(() => false)) {
      await prepare.click();
      await page.getByText("Test data is ready.").waitFor({ timeout: 180_000 }).catch(() => {});
      await start.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
    }
  }
  if (!(await start.isVisible().catch(() => false))) {
    console.error("Test Lab has no start buttons. Prepare test data on /admin/test-lab first.");
    process.exit(3);
  }
  await start.click();
  await page.waitForURL(DESTINATIONS[persona], { timeout: 120_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await ctx.storageState({ path: personaStatePath(persona) });
  console.log(`Saved ${persona} session to ${personaStatePath(persona)} (valid about two hours).`);
} finally {
  await browser.close();
}

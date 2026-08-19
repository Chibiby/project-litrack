import { test, expect, type Page } from "@playwright/test";
import net from "node:net";

/**
 * Covers the School Head login: a District narrowing filter, a searchable School
 * Name dropdown, and a School Head screen that asks for nothing but the School ID.
 *
 * Opt-in, like `smoke.spec.ts` — `playwright.config.ts` has no `webServer`, so start
 * `npm run dev` yourself or set PLAYWRIGHT_BASE_URL. Never point it at production.
 *
 * These tests read whatever schools the target database already has. They assert the
 * *behaviour* of the filter rather than any particular school or district name, so
 * they pass on a seeded database and on an imported roster alike. Where a case needs
 * data that may be absent (a district, or two districts) it skips instead of failing.
 */

const configuredBase = process.env.PLAYWRIGHT_BASE_URL;
const defaultBase = "http://localhost:3000";

async function isServerReachable(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const host = parsed.hostname;

  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const shouldRun = async () => {
  if (configuredBase) return true;
  return isServerReachable(defaultBase);
};

/** Matches the `searchPlaceholder` passed to SearchableSelect, minus the U+2026 ellipsis. */
const SEARCH_BOX = /Search schools/;

/**
 * The dropdown is replaced by a "No schools found" notice when the page received an
 * empty list, and every test here needs at least one school to pick.
 */
async function requireSchools(page: Page): Promise<void> {
  const empty = page.getByText("No schools found. Contact admin.");
  test.skip(
    (await empty.count()) > 0,
    "target database has no schools — run the roster import or db:seed first",
  );
}

/** The trigger is a `button role="combobox"`; a second combobox (the District Select) also exists, so go by label. */
function schoolTrigger(page: Page) {
  return page.getByLabel("School Name");
}

function districtTrigger(page: Page) {
  return page.getByLabel("District");
}

/** District names, in render order. Index 0 is the "All districts" sentinel. */
async function districtNames(page: Page): Promise<string[]> {
  await districtTrigger(page).click();
  const names = await page.getByRole("option").allInnerTexts();
  await page.keyboard.press("Escape");
  return names.map((n) => n.trim());
}

async function selectDistrict(page: Page, name: string): Promise<void> {
  await districtTrigger(page).click();
  await page.getByRole("option", { name, exact: true }).click();
  await expect(districtTrigger(page)).toContainText(name);
}

/** School names currently offered by the dropdown, which is left closed again. */
async function schoolNames(page: Page): Promise<string[]> {
  await schoolTrigger(page).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  const names = (await page.getByRole("option").allInnerTexts()).map((n) => n.trim());
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder(SEARCH_BOX)).toBeHidden();
  return names;
}

test.describe("School Head district login", () => {
  test.beforeAll(async () => {
    if (!(await shouldRun())) {
      test.skip(
        true,
        "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in",
      );
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await requireSchools(page);
  });

  test("the searchable dropdown filters schools as you type", async ({ page }) => {
    await schoolTrigger(page).click();

    const search = page.getByPlaceholder(SEARCH_BOX);
    await expect(search).toBeVisible();
    // The point of a "mini search" is that it is typeable the moment it opens.
    await expect(search).toBeFocused();

    const firstLabel = (await page.getByRole("option").first().innerText()).trim();
    const needle = firstLabel.split(/\s+/)[0];

    await search.fill(needle);
    await expect(page.getByRole("option").first()).toContainText(needle, {
      ignoreCase: true,
    });

    // A query that cannot match anything must say so rather than render an empty box.
    await search.fill("zzzzzzzzzz-no-such-school");
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByText("No schools match your search.")).toBeVisible();
  });

  test("keyboard selection works without leaving the search box", async ({ page }) => {
    await schoolTrigger(page).click();
    const search = page.getByPlaceholder(SEARCH_BOX);
    await expect(search).toBeFocused();

    const optionCount = await page.getByRole("option").count();
    // aria-activedescendant only advances when there is a second option to move to.
    test.skip(optionCount < 2, "need at least two schools to exercise arrow-key movement");

    await expect(search).toHaveAttribute("aria-activedescendant", /-opt-0$/);
    await search.press("ArrowDown");
    await expect(search).toHaveAttribute("aria-activedescendant", /-opt-1$/);
    // Focus must stay in the search box; the list is driven by activedescendant.
    await expect(search).toBeFocused();

    const secondLabel = (await page.getByRole("option").nth(1).innerText()).trim();
    await search.press("Enter");

    await expect(page.getByPlaceholder(SEARCH_BOX)).toBeHidden();
    // A row renders the school name and nothing else, so the trigger echoes it verbatim.
    await expect(schoolTrigger(page)).toContainText(secondLabel);
    await expect(page.getByRole("button", { name: "School Head" })).toBeEnabled();
  });

  test("district filter narrows the dropdown to that district", async ({ page }) => {
    const trigger = districtTrigger(page);
    test.skip((await trigger.count()) === 0, "no school in this database has a district");

    const names = await districtNames(page);
    const specific = names.slice(1);
    test.skip(specific.length < 2, "need two districts to compare what each one offers");

    await selectDistrict(page, specific[0]);
    const first = await schoolNames(page);
    await selectDistrict(page, specific[1]);
    const second = await schoolNames(page);

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);

    // A school belongs to exactly one district, so the two lists cannot overlap.
    // That is the filter contract, asserted without relying on any district text
    // being rendered inside the rows themselves.
    const overlap = first.filter((n) => second.includes(n));
    expect(overlap).toEqual([]);

    // And the exclusion is real, not just an ordering difference: a school from the
    // other district cannot be found even by searching for it by name.
    await schoolTrigger(page).click();
    await page.getByPlaceholder(SEARCH_BOX).fill(first[0]);
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(page.getByText("No schools match your search.")).toBeVisible();
  });

  test("switching district drops a school chosen from a different one", async ({ page }) => {
    const trigger = districtTrigger(page);
    test.skip((await trigger.count()) === 0, "no school in this database has a district");

    const names = await districtNames(page);
    const specific = names.slice(1);
    test.skip(specific.length < 2, "need two districts to test a stale selection");

    await selectDistrict(page, specific[0]);
    await schoolTrigger(page).click();
    await page.getByRole("option").first().click();

    const schoolHead = page.getByRole("button", { name: "School Head" });
    await expect(schoolHead).toBeEnabled();

    await selectDistrict(page, specific[1]);

    // The old school is no longer offered, so keeping it selected would let someone
    // sign in against a school the filter says they cannot see.
    await expect(schoolTrigger(page)).toContainText("Select your school");
    await expect(schoolHead).toBeDisabled();
    await expect(page.getByRole("button", { name: "Teachers" })).toBeDisabled();
  });

  test("the School Head screen asks for the School ID and nothing else", async ({ page }) => {
    await schoolTrigger(page).click();
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: "School Head" }).click();

    await expect(page.getByRole("heading", { name: "School Head sign in" })).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(
      page.getByText(/First time signing in\? Enter your School ID/),
    ).toBeVisible();

    // "Only district, school name and school ID" — no email or username on this screen.
    await expect(page.locator('input[name="email"]')).toHaveCount(0);
    await expect(page.locator('input[type="email"]')).toHaveCount(0);

    // The password box plus its show/hide toggle are the only inputs on the form.
    const formInputs = page.locator("form input");
    await expect(formInputs).toHaveCount(1);

    // Backing out must return to the picker rather than stranding the user here.
    await page.getByRole("button", { name: "Change school" }).click();
    await expect(schoolTrigger(page)).toBeVisible();
  });
});

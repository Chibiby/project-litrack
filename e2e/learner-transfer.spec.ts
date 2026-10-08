import { test, expect, type Page } from "@playwright/test";
import {
  assertNotProduction,
  hasPersonaSession,
  personaStatePath,
  shouldRunAgainstServer,
  skipReason,
} from "./helpers/e2e-env";

/**
 * Moving learners between sections of one grade, from the Learners page.
 *
 *   1. School Head: select learners on `/school-head/learners`, press
 *      "Transfer selected", pick a section in the same grade
 *      (nothing is pre-selected) and submit.
 *   2. Teacher: select a learner in an advised section on `/teacher/learners`,
 *      "Request transfer"; the School Head then approves it from the
 *      "Transfer requests" panel on the Learners page.
 *
 * Opt-in: start `npm run dev` yourself or set `PLAYWRIGHT_BASE_URL`. Never
 * point it at production; see `e2e/helpers/e2e-env.ts`.
 *
 * These tests WRITE real transfers (`transferLearnersToSection`,
 * `requestSectionTransfers`, `approveSectionTransferRequests` in
 * `src/lib/actions/section-transfer.ts`). Use a disposable learner in seeded
 * or demo data. Each test moves the learner back at the end so a re-run starts
 * from the same place, but a failed run can leave the learner moved.
 *
 * Required env vars:
 *   - LITRACK_E2E_TRANSFER_LEARNER_QUERY   a name substring that resolves to
 *     exactly one disposable learner on the Learners page's search box.
 *   - LITRACK_E2E_TRANSFER_TO_SECTION      the name of a live section in that
 *     learner's grade, with an adviser, other than the learner's own section.
 *   - LITRACK_E2E_TRANSFER_FROM_SECTION    the learner's current section name
 *     (the move-back target, and the section the teacher advises).
 *
 * Requires saved "head" and (for the request flow) "teacher" persona
 * sessions: `node e2e/auth/login.mjs`, then `node e2e/auth/persona.mjs head`.
 * The teacher persona must advise the learner's current section.
 */

const ENV = [
  "LITRACK_E2E_TRANSFER_LEARNER_QUERY",
  "LITRACK_E2E_TRANSFER_TO_SECTION",
  "LITRACK_E2E_TRANSFER_FROM_SECTION",
];

test.beforeAll(() => {
  assertNotProduction();
});

test.beforeAll(async () => {
  const ok = await shouldRunAgainstServer();
  test.skip(!ok, "PLAYWRIGHT_BASE_URL unset and no local server on :3000 — E2E is opt-in");
});

function env(name: (typeof ENV)[number]): string {
  return process.env[name]!;
}

/**
 * Narrow the directory/roster to the disposable learner (when the page has a
 * search box; the search is debounced, so the checkbox is awaited) and tick
 * the learner's row checkbox, labelled "Select <name>".
 */
async function selectTheLearner(page: Page, query: string) {
  const search = page.getByPlaceholder(/learner name|search/i).first();
  if ((await search.count()) > 0) await search.fill(query);
  const box = page.getByRole("checkbox", { name: new RegExp(`^Select .*${query}`, "i") }).first();
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.check();
}

/** School Head: "Transfer selected (N)" is a button above the directory, not a menu item. */
function transferSelectedButton(page: Page) {
  return page.getByRole("button", { name: /^Transfer selected/ });
}

async function chooseSection(page: Page, sectionName: string) {
  const dialog = page.getByRole("dialog");
  // A placement is a decision: nothing may be chosen when the dialog opens.
  for (const radio of await dialog.getByRole("radio").all()) {
    await expect(radio).not.toBeChecked();
  }
  await dialog.getByRole("radio", { name: new RegExp(sectionName, "i") }).check();
  return dialog;
}

test.describe("School Head transfers learners on the Learners page", () => {
  test.use({
    storageState: hasPersonaSession("head") ? personaStatePath("head") : undefined,
  });

  test.beforeEach(async ({ page }) => {
    const reason = skipReason({ envNames: ENV, persona: "head" });
    test.skip(!!reason, reason ?? "");
    await page.goto("/school-head/learners");
  });

  test("the old Transfer page is gone from the sidebar and redirects", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Learner Transfers" })).toHaveCount(0);
    await page.goto("/school-head/transfer");
    await expect(page).toHaveURL(/\/school-head\/learners/);
  });

  test("bulk transfer to another section of the same grade", async ({ page }) => {
    const query = env("LITRACK_E2E_TRANSFER_LEARNER_QUERY");
    const to = env("LITRACK_E2E_TRANSFER_TO_SECTION");
    const from = env("LITRACK_E2E_TRANSFER_FROM_SECTION");

    await selectTheLearner(page, query);
    await transferSelectedButton(page).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Submit stays disabled until a section is picked.
    await expect(dialog.getByRole("button", { name: /^Transfer/ })).toBeDisabled();

    await chooseSection(page, to);
    await expect(dialog.getByText(/Their adviser becomes/)).toBeVisible();
    await dialog.getByRole("button", { name: /^Transfer (learner|\d+ learners)$/ }).click();

    await expect(page.getByText(new RegExp(`moved to ${to}`, "i"))).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toBeHidden();

    // Put the learner back so the next run starts clean.
    await page.reload();
    await selectTheLearner(page, query);
    await transferSelectedButton(page).click();
    await chooseSection(page, from);
    await page.getByRole("dialog").getByRole("button", { name: /^Transfer (learner|\d+ learners)$/ }).click();
    await expect(page.getByText(new RegExp(`moved to ${from}`, "i"))).toBeVisible({ timeout: 15_000 });
  });

  test("a learner in the wrong grade selection is blocked with only Close", async ({ page }) => {
    // Needs two learners from different grades on the page; skip when the
    // seeded page shows fewer than two grades.
    const rowBoxes = page.getByRole("checkbox", { name: /^Select (?!all)/ });
    test.skip((await rowBoxes.count()) < 2, "need at least two learner rows");
    await page.getByRole("checkbox", { name: "Select all learners on this page" }).first().check();
    await transferSelectedButton(page).click();
    const dialog = page.getByRole("dialog");
    const mixed = dialog.getByText(/A transfer stays inside one grade/);
    test.skip((await mixed.count()) === 0, "the page's learners are all in one grade");
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Transfer/ })).toHaveCount(0);
  });
});

test.describe("Teacher requests a transfer, School Head approves", () => {
  test("request, then approve from the Transfer requests panel", async ({ browser }) => {
    const reason = skipReason({ envNames: ENV, persona: "teacher" }) ?? skipReason({ persona: "head" });
    test.skip(!!reason, reason ?? "");

    const query = env("LITRACK_E2E_TRANSFER_LEARNER_QUERY");
    const to = env("LITRACK_E2E_TRANSFER_TO_SECTION");
    const from = env("LITRACK_E2E_TRANSFER_FROM_SECTION");

    // 1. The teacher asks.
    const teacherCtx = await browser.newContext({ storageState: personaStatePath("teacher") });
    const teacher = await teacherCtx.newPage();
    await teacher.goto("/teacher/learners");
    await selectTheLearner(teacher, query);
    await teacher.getByRole("button", { name: /Bulk actions/ }).click();
    await teacher.getByRole("menuitem", { name: /Request transfer/ }).click();

    const request = teacher.getByRole("dialog");
    await expect(request.getByRole("button", { name: /^Request transfer/ })).toBeDisabled();
    await chooseSection(teacher, to);
    await request.getByLabel(/Note for your School Head/).fill("e2e transfer request");
    await request.getByRole("button", { name: /^Request transfer/ }).click();
    await expect(teacher.getByText(/Transfer requested for 1 learner/)).toBeVisible({ timeout: 15_000 });
    // The learner stays put and carries a badge until the School Head decides.
    await expect(teacher.getByText(new RegExp(`Transfer requested.*${to}`, "i")).first()).toBeVisible();
    await teacherCtx.close();

    // 2. The School Head approves from the panel above the directory.
    const headCtx = await browser.newContext({ storageState: personaStatePath("head") });
    const head = await headCtx.newPage();
    await head.goto("/school-head/learners");
    const panel = head.locator("#transfer-requests");
    await expect(panel.getByText(new RegExp(query, "i")).first()).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("Note: e2e transfer request")).toBeVisible();
    await panel.getByRole("button", { name: new RegExp(`Approve the transfer of .*${query}`, "i") }).click();
    await head.getByRole("alertdialog").getByRole("button", { name: "Approve and transfer" }).click();
    await expect(head.getByText(/approved\. The learners have moved\./)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText(new RegExp(query, "i"))).toHaveCount(0);

    // 3. Move the learner back so the next run starts clean.
    await selectTheLearner(head, query);
    await transferSelectedButton(head).click();
    await chooseSection(head, from);
    await head.getByRole("dialog").getByRole("button", { name: /^Transfer (learner|\d+ learners)$/ }).click();
    await expect(head.getByText(new RegExp(`moved to ${from}`, "i"))).toBeVisible({ timeout: 15_000 });
    await headCtx.close();
  });
});

import path from 'node:path';

export default async function step({ page, waitForCleanLoad, SCREENSHOTS_DIR }) {
  await page.goto('https://project-litrack-black.vercel.app/login', { waitUntil: 'domcontentloaded' });
  await waitForCleanLoad(page);
  await page.waitForTimeout(1000);

  // Take clean BEFORE shot without splash
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-01-choose-school-before.png'), fullPage: false });

  // Now re-select Alegria NHS so page is back in selected state
  const trigger = page.locator('#login-school');
  await trigger.click();
  await page.waitForTimeout(300);
  const searchInput = page.locator('input[placeholder*="Search"]');
  await searchInput.fill('Alegria NHS');
  await page.waitForTimeout(400);
  await page.locator('[role=option] >> text=Alegria NHS').click();
  await waitForCleanLoad(page);

  // Take AFTER shot
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-02-choose-school-after.png'), fullPage: false });

  return { ok: true };
}

import path from 'node:path';

export default async function step({ page, appendLog, waitForCleanLoad, SCREENSHOTS_DIR }) {
  await page.goto('https://project-litrack-black.vercel.app/login', { waitUntil: 'domcontentloaded' });
  await waitForCleanLoad(page);

  // Target element: School select combobox
  const trigger = page.locator('#login-school');
  await trigger.waitFor({ state: 'visible' });
  const box = await trigger.boundingBox();
  const coords = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;

  // 1. BEFORE shot
  const beforeFile = '01-01-choose-school-before.png';
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, beforeFile), fullPage: false });

  // 2. Click and select Alegria NHS
  await trigger.click();
  await page.waitForTimeout(300);
  const searchInput = page.locator('input[placeholder*="Search"]');
  await searchInput.fill('Alegria NHS');
  await page.waitForTimeout(400);
  await page.locator('[role=option] >> text=Alegria NHS').click();
  await waitForCleanLoad(page);

  // 3. AFTER shot
  const afterFile = '01-02-choose-school-after.png';
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, afterFile), fullPage: false });

  // 4. Log step
  appendLog({
    stepNum: '1.1',
    screenName: 'Module 1 - Role & School Selection',
    elementLabel: 'School Name (Select your school)',
    coords,
    value: 'Alegria NHS',
    beforeImg: beforeFile,
    afterImg: afterFile
  });

  return { ok: true, coords, selected: 'Alegria NHS' };
}

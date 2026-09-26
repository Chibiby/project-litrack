import path from 'node:path';

export default async function step({ page, appendLog, waitForCleanLoad, SCREENSHOTS_DIR }) {
  await waitForCleanLoad(page);

  // Target element: "School Head" button
  const shButton = page.locator('button', { hasText: 'School Head' });
  await shButton.waitFor({ state: 'visible' });
  const box = await shButton.boundingBox();
  const coords = box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;

  // 1. BEFORE shot
  const beforeFile = '01-03-click-school-head-before.png';
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, beforeFile), fullPage: false });

  // 2. Click School Head button
  await shButton.click();
  await waitForCleanLoad(page);

  // 3. AFTER shot
  const afterFile = '01-04-school-head-login-after.png';
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, afterFile), fullPage: false });

  // 4. Log step
  appendLog({
    stepNum: '1.2',
    screenName: 'Module 1 - Role Selection',
    elementLabel: 'School Head Button',
    coords,
    value: 'Click',
    beforeImg: beforeFile,
    afterImg: afterFile
  });

  return { ok: true, coords };
}

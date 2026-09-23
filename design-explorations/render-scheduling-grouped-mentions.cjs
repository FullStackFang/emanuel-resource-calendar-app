const { chromium } = require('playwright');
const { pathToFileURL } = require('url');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(pathToFileURL(path.join(__dirname, 'scheduling-grouped-mentions.html')).href);
  await page.screenshot({ path: path.join(__dirname, 'scheduling-grouped-mentions-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(__dirname, 'scheduling-grouped-mentions-mobile.png'), fullPage: true });
  await page.locator('[data-concept="a"] [data-remove]').first().click();
  await page.locator('[data-save="a"]').click();
  const aDetails = await page.locator('[data-concept="a"] .a-detail').first().textContent();
  if (aDetails.includes('Usher') || !aDetails.includes('North door')) throw new Error('Roster line edit failed');
  await page.locator('[data-concept="b"] input').fill('Stage left');
  await page.locator('[data-save="b"]').click();
  if (!(await page.locator('[data-concept="b"] .b-detail').first().textContent()).includes('Stage left')) throw new Error('Linked detail edit failed');
  await page.locator('[data-concept="c"] input').fill('Stage left');
  await page.locator('[data-add="c"]').click();
  if (!(await page.locator('[data-concept="c"] .c-detail').first().textContent()).includes('Stage left')) throw new Error('Roster column edit failed');
  console.log(await page.title());
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

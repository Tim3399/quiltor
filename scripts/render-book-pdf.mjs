import { chromium } from 'playwright';

const [url, target] = process.argv.slice(2);
if (!url || !target) throw new Error('URL und Zieldatei fehlen.');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByLabel('Kapiteltext').waitFor();
  await page.emulateMedia({ media: 'print' });
  await page.pdf({
    path: target,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
} finally {
  await browser.close();
}

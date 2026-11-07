// Fails loudly when the Chromium that `playwright install chromium` put down cannot start.
//
// The Windows browser jobs install the browser without `--with-deps` (T-45): the system half
// enabled Media Foundation on every run, cost 144-225 s per job, and the suites pass without it.
// Without the system half, a browser that cannot start would otherwise show up only as a
// timeout deep inside the test run. This launches it, renders a page and checks the result;
// any failure exits non-zero, and the job stops before a single test runs.

import { chromium } from "@playwright/test";

const EXPECTED = "chromium-starts";

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`<p id="probe">${EXPECTED}</p>`);
  const text = await page.textContent("#probe");
  if (text !== EXPECTED) {
    throw new Error(`the page rendered ${JSON.stringify(text)} instead of "${EXPECTED}"`);
  }
  console.log(`Chromium ${browser.version()} starts and renders a page.`);
} catch (error) {
  console.error(`Chromium does not start: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}

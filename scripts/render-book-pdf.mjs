import { chromium } from "playwright";

// The URL carries a one-shot render token, so it travels via env rather than
// argv to avoid sitting in plain sight in `ps`/Task Manager output.
const url = process.env.QUILTOR_RENDER_URL;
const [target] = process.argv.slice(2);
if (!url || !target) throw new Error("URL und Zieldatei fehlen.");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByLabel("Kapiteltext").waitFor();
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: target,
    preferCSSPageSize: true,
    printBackground: true,
    displayHeaderFooter: false,
  });
} finally {
  await browser.close();
}

import { chromium } from "playwright";

// The URL carries a one-shot render token, so it travels via env rather than
// argv to avoid sitting in plain sight in `ps`/Task Manager output.
const url = process.env.QUILTOR_RENDER_URL;
const [target] = process.argv.slice(2);
if (!url || !target) throw new Error("The render URL and target path are required.");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
  await page.waitForFunction(
    () => {
      const root = document.querySelector(".print-document");
      return (
        root?.getAttribute("data-book-ready") === "true" ||
        root?.getAttribute("data-book-error") === "true"
      );
    },
    undefined,
    { timeout: 90_000 },
  );
  const state = await page.locator(".print-document").evaluate((root) => ({
    ready: root.getAttribute("data-book-ready"),
    error: root.getAttribute("data-book-error"),
    pages: root.querySelectorAll(".pagedjs_page").length,
  }));
  if (state.error === "true") throw new Error("The book view reported a pagination error.");
  if (state.ready !== "true" || state.pages < 1) {
    throw new Error("The book view reported readiness without any physical pages.");
  }
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

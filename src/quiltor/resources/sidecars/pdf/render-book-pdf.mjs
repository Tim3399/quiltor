import { chromium } from "playwright";

// The URL carries a one-shot render token, so it travels via env rather than
// argv to avoid sitting in plain sight in `ps`/Task Manager output.
const url = process.env.QUILTOR_RENDER_URL;
const [target] = process.argv.slice(2);
if (!url || !target) throw new Error("The render URL and target path are required.");

// The page is another user's book. Playwright adds --no-sandbox unless this is
// exactly true; the container grants what the sandbox needs (see docker-compose.yml).
// An operator whose host grants no user namespaces opts out with QUILTOR_PDF_SANDBOX=off;
// nothing here falls back to that on its own.
const sandbox = (process.env.QUILTOR_PDF_SANDBOX ?? "").trim().toLowerCase() !== "off";
// One deadline for the whole render, below the server's own limit, so a page that
// never gets ready ends here with Chromium closed rather than being killed (T-370).
const budget = Number(process.env.QUILTOR_RENDER_DEADLINE_MS) || 70_000;
const deadline = Date.now() + budget;
const remaining = () => Math.max(deadline - Date.now(), 1);
const browser = await chromium.launch({ headless: true, chromiumSandbox: sandbox });
try {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "networkidle", timeout: remaining() });
  await page.waitForFunction(
    () => {
      const root = document.querySelector(".print-document");
      return (
        root?.getAttribute("data-book-ready") === "true" ||
        root?.getAttribute("data-book-error") === "true"
      );
    },
    undefined,
    { timeout: remaining() },
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

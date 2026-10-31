import { test as base, expect, type Page, type Request, type TestInfo } from "@playwright/test";

/*
 * Recover once from a socket the Windows runner could not hand out.
 *
 * Four red Windows runs (D-T-34-0, F2) had the same trace: one module of the start bundle
 * failed with net::ERR_NO_BUFFER_SPACE -- WSAENOBUFS, the runner out of socket buffers --
 * the application never booted, and the test waited on an empty page until its timeout.
 * Twenty-odd other requests of the same load succeeded. That is the machine, not Quiltor
 * and not the test, so the page is reloaded once and the test goes on.
 *
 * Deliberately narrow: only this failure text, only scripts, stylesheets and documents from
 * the application's own origin, at most once per page, and always recorded as an annotation
 * so a run that needed it says so. A missing asset answers 404 and is not a failed request;
 * a test that aborts a route on purpose produces a different failure text.
 */
const TRANSIENT_SOCKET_FAILURES: ReadonlySet<string> = new Set(["net::ERR_NO_BUFFER_SPACE"]);

const RELOADED_RESOURCE_TYPES = new Set(["document", "script", "stylesheet"]);

function needsReload(page: Page, request: Request): boolean {
  if (!TRANSIENT_SOCKET_FAILURES.has(request.failure()?.errorText ?? "")) return false;
  if (!RELOADED_RESOURCE_TYPES.has(request.resourceType())) return false;
  try {
    const pageUrl = page.url();
    if (!pageUrl.startsWith("http")) return true;
    return new URL(request.url()).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

function recoverFromTransientSocketFailures(page: Page, testInfo: TestInfo): void {
  let reloaded = false;
  page.on("requestfailed", (request) => {
    if (reloaded || page.isClosed() || !needsReload(page, request)) return;
    reloaded = true;
    testInfo.annotations.push({
      type: "transient-socket-reload",
      description: `${request.failure()?.errorText} on ${request.url()}; reloaded the page once.`,
    });
    page.reload().catch(() => {
      // The test may have closed or navigated the page in the meantime; its own
      // assertions report what follows.
    });
  });
}

export const test = base.extend<{ transientSocketRecovery: true }>({
  transientSocketRecovery: [
    async ({ page }, use, testInfo) => {
      recoverFromTransientSocketFailures(page, testInfo);
      await use(true);
    },
    { auto: true },
  ],
});

export { expect };

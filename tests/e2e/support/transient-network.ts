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

type BaseFixtures = {
  transientSocketRecovery: true;
  /** Every Content-Security-Policy violation the page reported. A test that provokes one on
   * purpose reads it here and empties it; anything left fails the test. */
  cspViolations: string[];
  cspGuard: true;
};

export const test = base.extend<BaseFixtures>({
  transientSocketRecovery: [
    async ({ page }, use, testInfo) => {
      recoverFromTransientSocketFailures(page, testInfo);
      await use(true);
    },
    { auto: true },
  ],
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern and rejects anything but object destructuring.
  cspViolations: async ({}, use) => {
    await use([]);
  },
  // On every product test, whichever fixture file it imports (T-61 part 5, F-61-21).
  // securitypolicyviolation fires in report-only mode as well, so the guard measures the
  // default server and needs no QUILTOR_CSP=enforce. The check reads only what the binding
  // collected, so it does not need the page to be open any more.
  cspGuard: [
    async ({ page, cspViolations }, use) => {
      await page.context().exposeBinding("__quiltorCspViolation", (_source, violation: string) => {
        cspViolations.push(violation);
      });
      await page.context().addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          const report = (window as unknown as { __quiltorCspViolation?: (v: string) => void })
            .__quiltorCspViolation;
          report?.(
            `${event.effectiveDirective} blocked ${event.blockedURI || "(inline)"} ` +
              `at ${event.sourceFile || event.documentURI}:${event.lineNumber} (${event.disposition})`,
          );
        });
      });
      await use(true);
      if (cspViolations.length > 0) {
        throw new Error(`Content-Security-Policy violations:\n${cspViolations.join("\n")}`);
      }
    },
    { auto: true },
  ],
});

export { expect };

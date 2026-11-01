import { readFileSync } from "node:fs";
import { createTestWorld, expect, test } from "./support/world-fixture";

// The server writes its structured log to QUILTOR_LOG_FILE; the suite learns the path from
// PLAYWRIGHT_SERVER_LOG. CI must never lose this proof silently, so there a missing path is a
// failure. Locally it is a skip that says how to run it.
const serverLog = process.env.PLAYWRIGHT_SERVER_LOG;

function logLines(path: string): Record<string, unknown>[] {
  let text = "";
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

test("The error id the editor shows for a rejected save is the one in the server log", async ({
  page,
}) => {
  if (!serverLog) {
    if (process.env.CI) {
      throw new Error(
        "PLAYWRIGHT_SERVER_LOG is not set: the CI product server runs without a log file " +
          "(QUILTOR_LOG_FILE), so the error id cannot be checked against the server log.",
      );
    }
    test.skip(
      true,
      "PLAYWRIGHT_SERVER_LOG is not set. Start the server with QUILTOR_LOG_FILE=<file> " +
        "(e.g. py -3.12 apps/web/server.py 8010 --no-open) and run the suite with " +
        "PLAYWRIGHT_SERVER_LOG=<the same file>.",
    );
    return;
  }

  const world = await createTestWorld(page, "Fehler-ID");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  const editor = page.getByLabel("Kapiteltext");
  await expect(editor).toBeVisible();

  // The request reaches the real server with a broken envelope, so the 400 and its
  // request id come from the server itself, not from the test.
  await page.route("**/api/manuscript*", (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    return route.continue({ postData: JSON.stringify({ broken: true }) });
  });

  await editor.fill("Dieser Satz wird nicht gespeichert.");
  const saveError = page.getByRole("alert").filter({ hasText: "Nicht gespeichert" });
  await expect(saveError).toBeVisible();
  const shown = page.locator(".app-save-status .save-status-component__error-id");
  await expect(shown).toBeVisible();
  await expect(shown).toHaveText(/^Fehler-ID: [A-Za-z0-9._-]{8,64}$/);
  const errorId = (
    await shown.locator(".save-status-component__error-id-value").textContent()
  )?.trim();
  expect(errorId).toMatch(/^[A-Za-z0-9._-]{8,64}$/);
  // The label keeps its text; one click selects the whole id, even where the line is cut off.
  await expect(saveError.locator(".save-status-component__state")).toContainText(
    "Nicht gespeichert",
  );
  await shown.locator(".save-status-component__error-id-value").click();
  expect(await page.evaluate(() => window.getSelection()?.toString().trim())).toBe(errorId);

  await expect
    .poll(
      () =>
        logLines(serverLog)
          .filter((line) => line.request_id === errorId)
          .map((line) => line.event),
      { message: `no log line carries request id ${errorId} in ${serverLog}` },
    )
    .toEqual(expect.arrayContaining(["http.access", "http.error"]));
});

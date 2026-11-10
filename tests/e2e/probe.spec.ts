import { expect, test } from "@playwright/test";
import { mockExampleWorld } from "./support/example-world";

/*
 * A measuring point inside the running application, without a throwaway file every time.
 *
 * Started through `npm run probe -- "<expression>"`; the expression runs in the page and its
 * result comes back as JSON. Without QUILTOR_PROBE this file does nothing, so it stays out
 * of the way during a normal run.
 *
 * Why a real browser rather than the embedded pane: a hidden browser pane does not paint, no
 * ResizeObserver fires there, and React Flow then measures nothing at all. Numbers taken
 * from there look like findings and are none.
 */

const EXPRESSION = process.env.QUILTOR_PROBE ?? "";
const WORKSPACE = process.env.QUILTOR_PROBE_WORKSPACE ?? "";
const WAIT = Number(process.env.QUILTOR_PROBE_WAIT ?? 2000);

test("Browser probe", async ({ page }) => {
  test.skip(!EXPRESSION, "Only with QUILTOR_PROBE; see npm run probe.");

  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  // The test world with its check part, so that the probe sees every kind of content.
  await mockExampleWorld(page, {
    include: ["base", "edge"],
    version: "sonde",
    world: { id: "sonde", title: "Sonde", backupUrl: "", updated: "2026-09-06T12:00:00Z" },
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Sonde – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

  if (WORKSPACE) {
    await page.getByRole("button", { name: WORKSPACE, exact: true }).click();
  }
  // The canvases fit their viewport on arrival; only after that do the numbers settle.
  await page.waitForTimeout(WAIT);

  const result = await page.evaluate((source) => new Function(`return (${source});`)(), EXPRESSION);
  console.log(`PROBE ${JSON.stringify(result ?? null)}`);
});

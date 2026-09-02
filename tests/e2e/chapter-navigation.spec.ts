import { devices } from "@playwright/test";
import { fulfillManuscript } from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

/**
 * The way out of a chapter on a device that cannot hover.
 *
 * On a desktop the affordance is revealed by the wheel gesture that will use
 * it. A phone has neither a hover nor a wheel event, so the same control has to
 * stand in the page and be tappable from the moment it renders -- and a swipe
 * is no substitute, because nothing a keyboard or a screen reader does can
 * perform one.
 */
test.use({ ...devices["Pixel 5"] });

const manuscript = {
  chapters: [
    { id: "c1", title: "Prolog", body: "Eins", note: "" },
    { id: "c2", title: "Im Wald", body: "Zwei", note: "" },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/manuscript*", (route) => fulfillManuscript(route, manuscript));
});

test("Auf Touchgeräten stehen die Kapitelwechsel sichtbar im Textfluss", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Test setzt sein Gerät selbst und hängt nicht an der Projektbreite.",
  );
  const world = await createTestWorld(page, "Kapitelwechsel");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();

  const next = page.getByRole("button", { name: "Nächstes Kapitel: Kapitel 2 · Im Wald" });
  await expect(next).toBeVisible();
  // Visible is not the same as reachable: the desktop affordance is painted at
  // zero opacity with its pointer events switched off until a gesture arms it.
  await expect(next).toHaveCSS("opacity", "1");
  await expect(next).toHaveCSS("pointer-events", "auto");
  expect(await next.evaluate((element) => getComputedStyle(element.parentElement!).position)).toBe(
    "static",
  );

  await next.click();
  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Im Wald");
  expect(await page.locator(".editor-scroll").evaluate((element) => element.scrollTop)).toBe(0);

  const previous = page.getByRole("button", { name: "Vorheriges Kapitel: Kapitel 1 · Prolog" });
  await expect(previous).toBeVisible();
  await previous.focus();
  await expect(previous).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Prolog");
  expect(
    await page.locator(".editor-scroll").evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
});

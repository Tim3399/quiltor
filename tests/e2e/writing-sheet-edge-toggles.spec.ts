import type { Locator, Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

// The two toggles that open the chapter navigation and the details stand in the margin beside
// the writing sheet, never on it -- in the focus mode and without it (T-242).

type Box = { x: number; width: number };

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const measured = await locator.boundingBox();
  expect(measured).not.toBeNull();
  return measured!;
}

async function expectBesideTheSheet(page: Page, left: Locator, right: Locator | null) {
  const sheet = await box(page.locator(".editor-page"));
  const start = await box(left);
  expect(start.x + start.width, "the left toggle ends before the sheet begins").toBeLessThanOrEqual(
    sheet.x,
  );
  if (right) {
    const end = await box(right);
    expect(end.x, "the right toggle begins after the sheet ends").toBeGreaterThanOrEqual(
      sheet.x + sheet.width,
    );
  }
}

async function closePanel(page: Page, name: string) {
  const close = page.getByRole("button", { name, exact: true });
  if (await close.isVisible()) await close.click();
}

test.beforeEach(async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "compact", "Compact opens the panels as sheets, no toggles.");
  const world = await seedExampleWorld(page, { open: false });
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
});

test("Without the focus mode the closed panels' toggles stand beside the sheet", async ({
  page,
}) => {
  await closePanel(page, "Kapitelnavigation schließen");
  await closePanel(page, "Details schließen");
  await expectBesideTheSheet(
    page,
    page.getByRole("button", { name: "Kapitelnavigation öffnen" }),
    page.getByRole("button", { name: "Details öffnen" }),
  );
});

test("With one panel open the other toggle still stands beside the sheet", async ({ page }) => {
  await closePanel(page, "Details schließen");
  const navigation = page.getByRole("button", { name: "Kapitelnavigation öffnen" });
  if (await navigation.isVisible()) await navigation.click();
  const sheet = await box(page.locator(".editor-page"));
  const details = await box(page.getByRole("button", { name: "Details öffnen" }));
  expect(details.x).toBeGreaterThanOrEqual(sheet.x + sheet.width);
});

test("In the focus mode the margin tabs stand beside the sheet", async ({ page }) => {
  await page.getByRole("button", { name: "Fokus", exact: true }).click();
  await expectBesideTheSheet(
    page,
    page.getByRole("button", { name: "Kapitelauswahl öffnen" }),
    page.getByRole("button", { name: "Details öffnen" }),
  );
});

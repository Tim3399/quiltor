import { expect, type Page, test } from "@playwright/test";

// The detail panel of the world areas (T-258): docked on wide layouts, a non-modal drawer up to
// 820px and a bottom drawer up to 640px. Geometry depends on the viewport, so every case sets
// its own and one project runs them.
test.beforeEach(async ({ page: _page }, testInfo) => {
  test.skip(testInfo.project.name !== "design-desktop", "sets its own viewports");
});

async function openStory(page: Page, story: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(`/?${new URLSearchParams({ story, theme: "light" }).toString()}`);
  await expect(page.locator("[data-design-story]")).toHaveAttribute("data-design-story", story);
}

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} has no box`);
  return rect;
}

test("a drawer leaves the work area usable and is never a dialog", async ({ page }) => {
  await openStory(page, "DetailPanel/Drawer", 375);
  const panel = page.getByRole("complementary", { name: "Zeitpunkt" });
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveAttribute("aria-modal", /.*/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The work area above the drawer still receives the pointer: nothing modal covers it.
  const work = page.getByText("Die Arbeitsfläche bleibt bedienbar.");
  const hit = await work.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const target = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    return target === element || element.contains(target);
  });
  expect(hit).toBe(true);
  expect(await page.locator("[inert]").count()).toBe(0);
});

test("up to 640px the drawer sits at the bottom across the full width", async ({ page }) => {
  await openStory(page, "DetailPanel/Drawer", 375);
  const host = await box(page, "[data-design-story] > div");
  const panel = await box(page, ".detail-panel");
  expect(Math.abs(panel.x - host.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(panel.width - host.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(panel.y + panel.height - (host.y + host.height))).toBeLessThanOrEqual(1);
  expect(panel.height).toBeLessThan(host.height);
});

test("between 641 and 820px the drawer docks on the right over the full height", async ({
  page,
}) => {
  await openStory(page, "DetailPanel/Drawer", 800);
  const host = await box(page, "[data-design-story] > div");
  const panel = await box(page, ".detail-panel");
  expect(Math.abs(panel.x + panel.width - (host.x + host.width))).toBeLessThanOrEqual(1);
  expect(Math.abs(panel.height - host.height)).toBeLessThanOrEqual(1);
  expect(panel.width).toBeLessThanOrEqual(320.5);
});

test("delete stays visible at the end of the panel, also with a blocked reason", async ({
  page,
}) => {
  for (const [story, width, name] of [
    ["DetailPanel/Drawer", 375, "Zeitpunkt löschen"],
    ["DetailPanel/WithTabs", 1280, "Ort löschen"],
  ] as const) {
    await openStory(page, story, width);
    const panel = await box(page, ".detail-panel");
    const button = page.getByRole("button", { name });
    await expect(button).toBeVisible();
    const footer = await box(page, ".detail-panel__footer");
    expect(Math.abs(footer.y + footer.height - (panel.y + panel.height))).toBeLessThanOrEqual(1);
    const last = await page
      .locator(".detail-panel")
      .evaluate((element) =>
        [...element.querySelectorAll<HTMLElement>("button, [tabindex='0']")]
          .at(-1)
          ?.textContent?.trim(),
      );
    expect(last).toBe(name);
  }
  await openStory(page, "DetailPanel/Drawer", 375);
  await expect(page.getByRole("button", { name: "Zeitpunkt löschen" })).toHaveAccessibleDescription(
    "Zwei Kapitel spielen zu diesem Zeitpunkt.",
  );
});

test("docked on wide layouts with the element name as heading", async ({ page }) => {
  await openStory(page, "DetailPanel/Default", 1280);
  const panel = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await expect(panel).toHaveAttribute("data-presentation", "docked");
  await expect(panel.getByRole("heading", { name: "Mara Lind" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Auswahl schließen" })).toBeVisible();
});

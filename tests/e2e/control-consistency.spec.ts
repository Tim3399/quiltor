import type { Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

async function openWorld(page: Page) {
  const world = await seedExampleWorld(page);
  await page.getByRole("textbox", { name: "Kapiteltitel" }).waitFor();
  return world;
}

async function visualState(page: Page, accessibleName: string) {
  return page.getByRole("button", { name: accessibleName }).evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      color: style.color,
    };
  });
}

test("priority and timeline controls keep visible states and usable targets", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "regular",
    "Wide and compact cover regular and touch targets.",
  );
  const world = await openWorld(page);
  // A figure that is not a favourite yet; Mara already is one.
  const figure = world.text("el.iven.name");
  const expectedHeight = testInfo.project.name === "compact" ? 44 : 36;

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => localStorage.setItem("quiltor-theme", value), theme);
    await page.reload();

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await page.locator(".story-node", { hasText: figure }).dispatchEvent("click");
    const priority = page.getByRole("button", { name: "Figur favorisieren" });
    await expect(priority).toHaveAttribute("aria-pressed", "false");
    await priority.evaluate(async (button) => {
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
    const inactive = await visualState(page, "Figur favorisieren");
    await priority.focus();
    await page.keyboard.press("Space");
    const active = page.getByRole("button", { name: "Favorit entfernen" });
    await expect(active).toHaveAttribute("aria-pressed", "true");
    await active.evaluate((button) => button.blur());
    await active.evaluate(async (button) => {
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
    expect(await visualState(page, "Favorit entfernen")).not.toEqual(inactive);

    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const addEnd = page.getByRole("button", { name: "Ende hinzufügen" });
    await expect(addEnd).toBeVisible();
    await expect
      .poll(() => addEnd.evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(expectedHeight);
    await addEnd.focus();
    await page.keyboard.press("Space");
    const removeEnd = page.getByRole("button", { name: "Ende entfernen" });
    await expect(removeEnd).toBeVisible();
    await expect
      .poll(() => removeEnd.evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(expectedHeight);
  }
});

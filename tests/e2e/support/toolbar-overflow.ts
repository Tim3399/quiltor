import type { Locator, Page } from "@playwright/test";

/**
 * Chooses an entry from a workspace toolbar's overflow menu ("Weitere Aktionen", T-104).
 *
 * `toolbar` is the toolbar's accessible name ("Manuskript", "Storyboard-Werkzeuge"). Each
 * further name is clicked in turn: `"Druckansicht"` runs the action and closes the menu. Called
 * with no entry, it leaves the menu open for the caller.
 */
export async function openToolbarOverflow(
  page: Page,
  toolbar: string,
  ...entries: string[]
): Promise<Locator> {
  const trigger = page
    .getByRole("toolbar", { name: toolbar, exact: true })
    .getByRole("button", { name: "Weitere Aktionen", exact: true });
  await trigger.click();
  for (const entry of entries) {
    await page.getByRole("menuitem", { name: entry, exact: true }).click();
  }
  return trigger;
}

/**
 * Switches a toolbar toggle on or off (T-258, styleguide 7.4). On a wide row it is a pressed
 * button; on a compact row, or for a rare setting such as the grid, a checkable entry of
 * "Weitere Aktionen". Leaves it alone when it already has that state, and closes the menu again.
 */
export async function setToolbarToggle(page: Page, toolbar: string, name: string, on: boolean) {
  const bar = page.getByRole("toolbar", { name: toolbar, exact: true });
  const button = bar.getByRole("button", { name, exact: true });
  if (await button.isVisible()) {
    if ((await button.getAttribute("aria-pressed")) !== String(on)) await button.click();
    return;
  }
  await bar.getByRole("button", { name: "Weitere Aktionen", exact: true }).click();
  const item = page.getByRole("menuitemcheckbox", { name, exact: true });
  await item.waitFor();
  if ((await item.getAttribute("aria-checked")) !== String(on)) await item.click();
  // A setting keeps its menu open, so several can be changed in one visit.
  await page.keyboard.press("Escape");
  await item.waitFor({ state: "detached" });
}

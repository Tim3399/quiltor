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

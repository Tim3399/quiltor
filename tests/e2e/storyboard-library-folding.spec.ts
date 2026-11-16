import type { Page } from "@playwright/test";
import { createTestWorld, expect, test } from "./support/world-fixture";

async function openStoryboardLibrary(page: Page, worldId: string) {
  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();
  const library = page.locator("aside.storyboard-library");
  if (!(await library.isVisible())) {
    await page
      .getByRole("toolbar", { name: "Storyboard-Werkzeuge" })
      .getByRole("button", { name: "Elementbibliothek ein-/ausblenden" })
      .click();
  }
  await expect(library).toBeVisible();
  return library;
}

test("the library groups its entries by kind and still places them after folding and opening", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Native drag and drop only needs one run in a stable desktop viewport.",
  );
  const world = await createTestWorld(page, `Bibliothek Gruppen ${crypto.randomUUID()}`);
  const library = await openStoryboardLibrary(page, world.id);

  const heading = library.getByRole("button", { name: /^Kapitel/ });
  const chapter = library.getByRole("button", {
    name: "Ohne Titel auf dem Storyboard platzieren",
    exact: true,
  });
  await expect(heading).toHaveAttribute("aria-expanded", "true");
  await heading.click();
  await expect(chapter).toBeHidden();
  await heading.click();
  await expect(chapter).toBeVisible();

  const emptyState = page.getByLabel("Platz für deine Ideen", { exact: true });
  await chapter.dragTo(emptyState);
  const card = page.locator('[data-storyboard-node-kind="reference"]');
  await expect(card).toHaveCount(1);

  await heading.click();
  await heading.click();
  await chapter.click();
  await expect(card).toHaveCount(2);
});

test("a folded library group stays folded after a reload, in that world only", async ({ page }) => {
  const first = await createTestWorld(page, `Bibliothek Falten A ${crypto.randomUUID()}`);
  const second = await createTestWorld(page, `Bibliothek Falten B ${crypto.randomUUID()}`);

  let library = await openStoryboardLibrary(page, first.id);
  const heading = () => library.getByRole("button", { name: /^Kapitel/ });
  await heading().click();
  await expect(heading()).toHaveAttribute("aria-expanded", "false");

  library = await openStoryboardLibrary(page, first.id);
  await expect(heading()).toHaveAttribute("aria-expanded", "false");

  library = await openStoryboardLibrary(page, second.id);
  await expect(heading()).toHaveAttribute("aria-expanded", "true");
});

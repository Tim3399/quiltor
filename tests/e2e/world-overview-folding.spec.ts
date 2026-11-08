import type { Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

async function openFigures(page: Page, worldId: string) {
  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Weltübersicht" })).toBeVisible();
}

test("a folded kind in the world overview stays folded after a reload, in that world only", async ({
  page,
}) => {
  test.skip(
    (page.viewportSize()?.width ?? 0) <= 820,
    "the overview column gives way to the canvas on narrow surfaces",
  );
  const first = await seedExampleWorld(page, { open: false });
  const second = await seedExampleWorld(page, { open: false });
  const mara = first.text("el.mara.name");
  const archive = first.text("el.archive.name");

  await openFigures(page, first.id);
  const overview = page.getByRole("complementary", { name: "Weltübersicht" });
  const kind = overview.getByRole("button", { name: /^Figur/ });
  await expect(kind).toHaveAttribute("aria-expanded", "true");
  await kind.click();
  await expect(kind).toHaveAttribute("aria-expanded", "false");
  await expect(overview.getByRole("button", { name: mara })).toBeHidden();
  await expect(overview.getByRole("button", { name: archive })).toBeVisible();

  // A reload opens the text workspace again; the fold is read from the stored preference.
  await openFigures(page, first.id);
  await expect(overview.getByRole("button", { name: /^Figur/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await openFigures(page, second.id);
  await expect(overview.getByRole("button", { name: /^Figur/ })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(overview.getByRole("button", { name: mara })).toBeVisible();

  await openFigures(page, first.id);
  await expect(overview.getByRole("button", { name: /^Figur/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

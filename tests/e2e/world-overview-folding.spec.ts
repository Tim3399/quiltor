import type { Page } from "@playwright/test";
import type { FigureState } from "../../packages/client/src/modules/story-world";
import { encodeStoryWorldV1 } from "../../packages/client/src/platform/contracts/v1/storyWorld";
import { putVersioned } from "./support/seed";
import { createTestWorld, expect, test } from "./support/world-fixture";

const storyWorld: FigureState = {
  nodes: [
    { id: "mara", x: 0, y: 0, type: "person", name: "Mara Venn" },
    { id: "iven", x: 200, y: 0, type: "person", name: "Iven Rook" },
    { id: "archiv", x: 0, y: 200, type: "ort", name: "Gezeitenarchiv" },
  ],
  edges: [],
};

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
  const first = await createTestWorld(page, "Faltwelt A");
  const second = await createTestWorld(page, "Faltwelt B");
  for (const world of [first, second]) {
    await putVersioned(page, `/api/state?world=${world.id}`, (revision) =>
      encodeStoryWorldV1(storyWorld, revision),
    );
  }

  await openFigures(page, first.id);
  const overview = page.getByRole("complementary", { name: "Weltübersicht" });
  const kind = overview.getByRole("button", { name: /^Figur/ });
  await expect(kind).toHaveAttribute("aria-expanded", "true");
  await kind.click();
  await expect(kind).toHaveAttribute("aria-expanded", "false");
  await expect(overview.getByRole("button", { name: "Mara Venn" })).toBeHidden();
  await expect(overview.getByRole("button", { name: "Gezeitenarchiv" })).toBeVisible();

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
  await expect(overview.getByRole("button", { name: "Mara Venn" })).toBeVisible();

  await openFigures(page, first.id);
  await expect(overview.getByRole("button", { name: /^Figur/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

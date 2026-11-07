import { exampleWorldDocuments, mockExampleWorld, seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

test.describe("the test world", () => {
  test("seeds base and check part on the server and opens them", async ({ page }) => {
    const world = await seedExampleWorld(page, { include: ["base", "edge"] });

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await expect(
      page.locator(".story-node").filter({ hasText: world.text("el.mara.name") }),
    ).toBeVisible();
    await expect(
      page.getByText(world.text("el.x-long-name.name"), { exact: true }).first(),
    ).toBeAttached();

    // The server keeps a reference card whose element does not exist (T-177).
    const saved = await page.request.get(`/api/storyboards?world=${world.id}`);
    const cards = (await saved.json()).payload.nodes as { id: string; target?: { id: string } }[];
    expect(cards.find((card) => card.id === world.ids.cards.xRefDeleted)?.target?.id).toBe(
      "x-gone",
    );
    const state = await page.request.get(`/api/state?world=${world.id}`);
    const nodes = (await state.json()).payload.nodes as { id: string }[];
    expect(nodes.some((node) => node.id === "x-gone")).toBe(false);
    expect(nodes.filter((node) => node.id.startsWith("x-cluster-"))).toHaveLength(8);
  });

  test("seeds the English base world without the check part", async ({ page }) => {
    const world = await seedExampleWorld(page, { lang: "en", open: false });

    const state = await page.request.get(`/api/state?world=${world.id}`);
    const nodes = (await state.json()).payload.nodes as { id: string; name: string }[];
    expect(nodes.find((node) => node.id === world.ids.figures.archive)?.name).toBe("Tidal Archive");
    expect(nodes.some((node) => node.id.startsWith("x-"))).toBe(false);
  });

  test("serves mocking specs the decoded world", async ({ page }) => {
    const documents = exampleWorldDocuments({ include: ["base", "edge"] });
    expect(documents.storyWorld.nodes.some((node) => node.id === "x-long-name")).toBe(true);
    expect(documents.manuscript.chapters.some((chapter) => chapter.id === "x-empty-chapter")).toBe(
      true,
    );

    const world = await mockExampleWorld(page);
    await page.goto("/?world=example-world");
    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await expect(
      page.locator(".story-node").filter({ hasText: world.text("el.ada.name") }),
    ).toBeVisible();
  });
});

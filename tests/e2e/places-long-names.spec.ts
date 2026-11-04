import type { FigureNode } from "../../packages/client/src/modules/story-world/model";
import { encodeStoryWorldDocument } from "./support/application-api";
import { putVersioned } from "./support/seed";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-124: a long place name was cut with an ellipsis in two spots that offered no way to read
// it: the inspector's pin/card action (its label carries the name) and the name on the map
// node. The action now wraps its label; the node name carries the full name as its title.

const name = "Halligwarftsiedlung am äußersten Rand des nordfriesischen Wattenmeeres";
const place: FigureNode = { id: "warft", type: "ort", name, x: 80, y: 80 };

test("a long place name stays readable in the inspector action and on the map node", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => localStorage.setItem("quiltor-interface-language", "de"));
  const world = await createTestWorld(page, `Orte-Langname ${testInfo.project.name}`);
  await putVersioned(page, `/api/state?world=${world.id}`, (revision) =>
    encodeStoryWorldDocument({ nodes: [place], edges: [], timeline: [], presence: [] }, revision),
  );
  await page.goto(`/?world=${world.id}`);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  const node = page.locator(`.react-flow__node[data-id="${place.id}"] .story-node`);
  await expect(node.locator("strong")).toHaveAttribute("title", name);
  await node.click({ position: { x: 12, y: 12 } });
  const inspector = page.locator('[aria-label="Orte-Inspector"]').filter({ visible: true });
  await expect(inspector).toBeVisible();

  const label = inspector.locator(".places-display-action .ui-button__label");
  await expect(label).toContainText(name);
  const box = await label.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflow: getComputedStyle(element).textOverflow,
  }));
  expect(box.scrollWidth, "the action's label is cut off").toBeLessThanOrEqual(box.clientWidth + 1);
});

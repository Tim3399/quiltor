import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

// T-124: a long place name was cut with an ellipsis in two spots that offered no way to read
// it: the inspector's pin/card action (its label carries the name) and the name on the map
// node. The action now wraps its label; the node name carries the full name as its title.
//
// The test world's check part has such a place, a pin on the city level of Nordhafen.

test("a long place name stays readable in the inspector action and on the map node", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("quiltor-interface-language", "de"));
  const world = await seedExampleWorld(page, { include: ["base", "edge"] });
  const name = world.text("el.x-long-place.name");
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  // On a narrow canvas the world fits so far out that the cards are circles without their
  // commands; step in until the city offers to be opened.
  const open = page.getByRole("button", { name: `${world.text("el.nordhafen.name")} öffnen` });
  await expect
    .poll(async () => {
      if (!(await open.isVisible())) await page.locator(".react-flow__controls-zoomin").click();
      return open.isVisible();
    })
    .toBe(true);
  await open.click();
  const node = page.locator(`.react-flow__node[data-id="${world.ids.figures.xLongPlace}"]`);
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

import { seedExampleWorld } from "./support/example-world";
import { placeCardCommand } from "./support/expanded-map-fixture";
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
  // On a narrow canvas the city is opened from its inspector sheet (D-T-219-F2); wider, from
  // its card, which the fitted world may draw as a circle without commands, so step in there.
  const nordhafen = world.text("el.nordhafen.name");
  if ((page.viewportSize()?.width ?? 0) > 820) {
    const open = page.getByRole("button", { name: `${nordhafen} öffnen` });
    await expect
      .poll(async () => {
        if (!(await open.isVisible())) await page.locator(".react-flow__controls-zoomin").click();
        return open.isVisible();
      })
      .toBe(true);
    await open.click();
  } else {
    await (
      await placeCardCommand(page, world.ids.figures.nordhafen, `${nordhafen} öffnen`)
    ).click();
  }
  const node = page.locator(`.react-flow__node[data-id="${world.ids.figures.xLongPlace}"]`);
  await expect(node.locator("strong")).toHaveAttribute("title", name);
  await node.click({ position: { x: 12, y: 12 } });
  const inspector = page.locator('[aria-label="Orte-Inspector"]').filter({ visible: true });
  await expect(inspector).toBeVisible();

  // The pin/card toggle; on a phone the level command (D-T-219-F2) follows it in the sheet.
  const label = inspector.locator(".places-display-action .ui-button__label").first();
  await expect(label).toContainText(name);
  const box = await label.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    overflow: getComputedStyle(element).textOverflow,
  }));
  expect(box.scrollWidth, "the action's label is cut off").toBeLessThanOrEqual(box.clientWidth + 1);
});

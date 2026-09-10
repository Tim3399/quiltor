import { expect, test } from "./support/world-fixture";
import {
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  waitForMapViewport,
} from "./support/expanded-map-fixture";

test("Map child pins and cards stop painting outside their host frame", async ({ page }, info) => {
  test.skip(info.project.name !== "compact", "The narrow surface exposes the clipped map edge.");
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "dark");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  const state = expandedMapState();
  const place = state.nodes.find((node) => node.id === "graufurth")!;
  place.placeDisplay = "pin";
  const fixture = await mockExpandedMapWorld(page, state);
  await openExpandedMapWorld(page);
  const node = page.locator('.react-flow__node[data-id="graufurth"]');
  const pin = node.locator(".place-node-pin");
  const header = page.locator(".place-map-chrome__header");
  const canvas = await page.locator(".places-flow-area").boundingBox();
  const tip = await pin.locator(".place-node-pin__tip").boundingBox();
  const top = await header.boundingBox();
  if (!canvas || !tip || !top) throw new Error("Map and child need measurable geometry.");
  // Move the pin anchor into the gutter left of the docked map frame.
  const dx = top.x - 25 - (tip.x + tip.width / 2);
  const x = canvas.x + canvas.width * 0.6;
  const y = canvas.y + canvas.height * 0.45;
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + dx, y, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await waitForMapViewport(page);
  const outside = await pin.locator(".place-node-pin__mark").boundingBox();
  const frame = await header.boundingBox();
  if (!outside || !frame) throw new Error("Off-frame pin must retain its world geometry.");
  expect(outside.x + outside.width / 2).toBeLessThan(frame.x);
  await expect
    .poll(() =>
      pin.evaluate((root) => {
        const mark = root.querySelector(".place-node-pin__mark")!.getBoundingClientRect();
        return document
          .elementsFromPoint(mark.left + mark.width / 2, mark.top + mark.height / 2)
          .some((element) => root.closest(".react-flow__node")!.contains(element));
      }),
    )
    .toBe(false);
  await page.screenshot({
    path: info.outputPath("pin-clipped-at-map-edge.png"),
    animations: "disabled",
  });

  // A partially intersecting card obeys the same boundary, including its name and shadow.
  const card = page.locator('.react-flow__node[data-id="tannenhain"] .place-node-shell');
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error("The ordinary map card has no geometry.");
  const shift = frame.x - (bounds.x + bounds.width * 0.4);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(x + shift, y, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await waitForMapViewport(page);
  const visiblePart = await card.evaluate((root) => {
    const header = root
      .closest(".places-flow-area")!
      .querySelector(".place-map-chrome__header")!
      .getBoundingClientRect();
    const rect = root.getBoundingClientRect();
    return {
      left: Math.max(header.left, rect.left),
      right: Math.min(header.right, rect.right),
      y: rect.top + rect.height / 2,
    };
  });
  expect(visiblePart.right - visiblePart.left).toBeGreaterThan(20);
  await expect
    .poll(() =>
      card.evaluate(
        (root, point) =>
          document
            .elementsFromPoint((point.left + point.right) / 2, point.y)
            .some((element) => root.contains(element)),
        visiblePart,
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      card.evaluate((root) => {
        const header = root
          .closest(".places-flow-area")!
          .querySelector(".place-map-chrome__header")!
          .getBoundingClientRect();
        const rect = root.getBoundingClientRect();
        return document
          .elementsFromPoint(header.left - 4, rect.top + rect.height / 2)
          .some((element) => root.closest(".react-flow__node")!.contains(element));
      }),
    )
    .toBe(false);
  await page.screenshot({
    path: info.outputPath("card-clipped-at-map-edge.png"),
    animations: "disabled",
  });
  expect(fixture.savedState().nodes.find((item) => item.id === place.id)).toMatchObject({
    placeDisplay: "pin",
    parentPlaceId: "weltkarte",
    mapU: 0.3,
    mapV: 0.4,
  });
});

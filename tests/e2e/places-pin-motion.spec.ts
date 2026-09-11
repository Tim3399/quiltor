import { mockExpandedMapWorld, openExpandedMapWorld } from "./support/expanded-map-fixture";
import { expect, test } from "./support/world-fixture";

test("Place motion keeps the tip anchored through rapid keyboard toggles", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "wide", "Motion geometry is covered on the wide canvas.");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const fixture = await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const node = page.locator('.react-flow__node[data-id="graufurth"]');
  const card = node.locator(".story-node");
  const bounds = await card.boundingBox();
  if (!bounds) throw new Error("The initial card has no geometry.");
  const anchor = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const toPin = node.getByRole("button", { name: "Ort Graufurth als Stecknadel anzeigen" });
  const toCard = node.getByRole("button", { name: "Ort Graufurth als Karte anzeigen" });

  await toPin.press("Enter");
  await expect
    .poll(
      () =>
        node.evaluate((element) =>
          element.getAnimations({ subtree: true }).some((animation) => {
            if (!(animation.effect instanceof KeyframeEffect)) return false;
            const transforms = animation.effect.getKeyframes().map((frame) => frame.transform);
            return animation.playState === "running" && new Set(transforms).size > 1;
          }),
        ),
      { intervals: [10, 20, 30], timeout: 800 },
    )
    .toBe(true);
  await expect(toCard).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toPin).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(toCard).toBeFocused();

  const tip = node.locator(".place-node-pin__tip");
  const samples = await tip.evaluate(async (element) => {
    const points: { x: number; y: number }[] = [];
    for (let frame = 0; frame < 18; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = element.getBoundingClientRect();
      points.push({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    }
    return points;
  });
  for (const point of samples) {
    expect(Math.abs(point.x - anchor.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(point.y - anchor.y)).toBeLessThanOrEqual(1.5);
  }
  await expect(node.locator(".is-display-transition")).toHaveCount(0);
  await expect(node.getByRole("button", { name: /als (Karte|Stecknadel) anzeigen/ })).toHaveCount(
    1,
  );
  await expect
    .poll(() => fixture.savedState().nodes.find((place) => place.id === "graufurth"))
    .toMatchObject({ placeDisplay: "pin", parentPlaceId: "weltkarte", mapU: 0.3, mapV: 0.4 });
});

test("Reduced motion keeps place toggles immediate and keyboard accessible", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "wide", "Reduced motion is covered once.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);
  const node = page.locator('.react-flow__node[data-id="graufurth"]');
  const toPin = node.getByRole("button", { name: "Ort Graufurth als Stecknadel anzeigen" });
  const toCard = node.getByRole("button", { name: "Ort Graufurth als Karte anzeigen" });

  for (const [action, inverse] of [
    [toPin, toCard],
    [toCard, toPin],
  ]) {
    await action.press("Enter");
    await expect(inverse).toBeFocused();
    await inverse.hover();
    const moving = await node.evaluate(
      (element) =>
        element.getAnimations({ subtree: true }).filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            animation.playState === "running" &&
            (Number(timing?.duration ?? 0) > 1 || Number(timing?.delay ?? 0) > 1)
          );
        }).length,
    );
    expect(moving).toBe(0);
  }
});

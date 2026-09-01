import { expect, type Locator, type Page } from "@playwright/test";

export async function clickVisibleGraphEdge(page: Page, edge: Locator) {
  await expect(edge).toHaveCount(1);
  const point = await edge.evaluate((element) => {
    const path = element.querySelector<SVGPathElement>(".react-flow__edge-interaction");
    if (!path) throw new Error("Graph edge has no interaction path");
    const matrix = path.getScreenCTM();
    if (!matrix) throw new Error("Graph edge has no screen transformation");

    const length = path.getTotalLength();
    const samples = Math.min(1_000, Math.max(40, Math.ceil(length / 3)));
    for (let sample = 1; sample < samples; sample += 1) {
      const pathPoint = path.getPointAtLength((length * sample) / samples);
      const screenPoint = new DOMPoint(pathPoint.x, pathPoint.y).matrixTransform(matrix);
      if (
        screenPoint.x < 0 ||
        screenPoint.y < 0 ||
        screenPoint.x >= window.innerWidth ||
        screenPoint.y >= window.innerHeight
      ) {
        continue;
      }
      const hit = document.elementFromPoint(screenPoint.x, screenPoint.y);
      if (hit === path || hit?.closest(".react-flow__edge") === element) {
        return { x: screenPoint.x, y: screenPoint.y };
      }
    }
    return null;
  });

  if (!point) throw new Error("Graph edge has no unobscured interaction point");
  await page.mouse.click(point.x, point.y);
  await expect(edge).toHaveClass(/\bselected\b/);
}

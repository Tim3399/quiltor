import { expect, type Page } from "@playwright/test";

/*
 * Wait until the places canvas and every card on it stand still.
 *
 * On the compact viewport the places canvas fits once its cards are measured, and a card
 * standing half outside the left edge (Graufurth) then lay a fraction of a pixel elsewhere
 * from run to run: probed locally, 1 of 6 captures differed by 100 px around that card while
 * the viewport transform had already been equal twice. Two identical readings of the
 * viewport and of every card's rectangle in a row are what is waited for (T-231).
 *
 * Standing still is not enough on its own. With the geometry byte-identical in every run,
 * light and dark compact captures still came out in two or three states, each a whole raster
 * tile around Tannenhain and the coast: Chromium keeps the tiles it rastered while the fit
 * was changing the scale, and re-rasters them at the final scale only later, or not before
 * the capture. Waiting 1.5 s fixed light but not dark. Taking a layer out of the layout for
 * a frame drops its tiles, and the capture then sees one raster of the final state
 * (T-231, D-T-231-2). Scroll positions are put back, since display: none resets them.
 */
export async function waitForPlacesCanvasToStandStill(page: Page) {
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() =>
          JSON.stringify([
            document
              .querySelector(".places-flow-area .react-flow__viewport")
              ?.getAttribute("style"),
            [...document.querySelectorAll(".places-flow-area .react-flow__node")].map((node) => {
              const rect = node.getBoundingClientRect();
              return [node.getAttribute("data-id"), rect.x, rect.y, rect.width, rect.height];
            }),
          ]),
        );
        const still = current === previous;
        previous = current;
        return still;
      },
      { message: "The places canvas keeps moving its cards." },
    )
    .toBe(true);
  await page.evaluate(async (selectors) => {
    const layers = selectors.flatMap((selector) => [
      ...document.querySelectorAll<HTMLElement>(selector),
    ]);
    const scroll = layers.map((layer) => [layer.scrollLeft, layer.scrollTop] as const);
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (const layer of layers) layer.style.display = "none";
    document.body.getBoundingClientRect();
    await frame();
    layers.forEach((layer, index) => {
      layer.style.display = "";
      [layer.scrollLeft, layer.scrollTop] = scroll[index];
    });
    await frame();
    await frame();
  }, RASTERED_LAYERS);
}

/*
 * The layers whose raster came out stale, each found by a capture that differed while the
 * DOM did not: the canvas viewport (tiles around Tannenhain and the coast), and the
 * toolbar's scroll area, a composited scroller whose overflow button "Ortsaktionen" showed
 * its rounded corners in two rasters -- 1 of 10 real toHaveScreenshot captures per theme,
 * with its rectangle, colours, opacity and outline identical in all 20 runs.
 * The map chrome joined them on linux: header and footer lie over the zoomed canvas, so
 * Chromium gives them layers of their own, and the footer's bottom-right corner came out
 * with 8 pixels one step apart in the bootstrap's second take of dark-expanded-map-regular
 * (run 42771146866).
 */
const RASTERED_LAYERS = [
  ".places-flow-area .react-flow__viewport",
  ".places-toolbar .scroll-area",
  ".place-map-chrome",
];

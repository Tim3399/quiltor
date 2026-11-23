import type { Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

/**
 * T-326: the timeline strip on the figure board, where the minimap leaves it narrow.
 *
 * The user's screenshot: the first moment "Ankunft im Nordh" cut off by the edge of the
 * track, an empty sliver beside it where the new-moment field had been squeezed, and the
 * moment's number stuck to the top edge. Since T-328 the strip is docked above the canvas and
 * spans its whole width, so the minimap no longer narrows it; the open inspector still does.
 * At every width below the strip has to keep its parts readable.
 */
const WIDTHS = [1100, 1180, 1280, 1366, 1440];

type Box = { left: number; right: number; top: number; bottom: number; width: number };

async function measure(page: Page) {
  return page.locator(".timeline-strip").evaluate((strip) => {
    const box = (element: Element | null): Box | null => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    // The track is itself the ScrollArea that clips its content.
    const viewport = strip.querySelector(".timeline-track");
    const first = strip.querySelector(".timeline-moment");
    const title = first?.querySelector(".timeline-moment-copy b") as HTMLElement | null;
    return {
      strip: box(strip),
      track: box(viewport),
      button: box(first?.querySelector(".timeline-moment-button") ?? null),
      number: box(first?.querySelector(":scope > span") ?? null),
      titleField: box(strip.querySelector(".timeline-title")),
      dateField: box(strip.querySelector(".timeline-add .timeline-date")),
      add: box(strip.querySelector(".timeline-add")),
      truncated: title ? title.scrollWidth > title.clientWidth + 1 : false,
      buttonTitle: first?.querySelector(".timeline-moment-button")?.getAttribute("title") ?? null,
      pageScroll: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
}

for (const width of WIDTHS) {
  test(`The timeline strip keeps its first moment, number and add field readable at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 860 });
    const world = await seedExampleWorld(page, { open: false });
    const momentTitle = world.text("moment.t1.title");
    await page.goto(`/?world=${world.id}`);
    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    const strip = page.locator(".timeline-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByRole("button", { name: momentTitle })).toBeVisible();

    // The strip as the user saw it, for the before/after record (orchestrator/belege).
    await strip.screenshot({ path: testInfo.outputPath(`timeline-strip-${width}.png`) });
    const m = await measure(page);
    const where = JSON.stringify(m);
    expect(m.strip && m.track && m.button && m.number && m.titleField, where).toBeTruthy();
    const {
      strip: s,
      track: t,
      button: b,
      number: n,
      titleField: f,
      add: a,
    } = m as Required<{
      [K in keyof typeof m]: NonNullable<(typeof m)[K]>;
    }>;

    // No overflow: the strip's parts stay inside the strip, the page does not scroll sideways.
    expect(m.pageScroll, `page scrolls sideways: ${where}`).toBeLessThanOrEqual(0);
    expect(a.left, `add controls start left of the strip: ${where}`).toBeGreaterThanOrEqual(
      s.left - 1,
    );
    expect(a.right, `add controls run past the strip: ${where}`).toBeLessThanOrEqual(s.right + 1);

    // The first moment is whole: not cut off by the edge of the track.
    expect(b.left, `moment starts outside the track: ${where}`).toBeGreaterThanOrEqual(t.left - 1);
    expect(b.right, `moment is cut off by the track: ${where}`).toBeLessThanOrEqual(t.right + 1);
    // A title that still does not fit ends in an ellipsis and keeps the whole one as a tooltip.
    if (m.truncated) expect(m.buttonTitle, where).toBe(momentTitle);

    // No empty cell: the new-moment field keeps the width it is drawn with.
    expect(f.width, `new-moment field squeezed: ${where}`).toBeGreaterThanOrEqual(120);

    // The number sits fully inside the track, clear of its top edge.
    expect(n.top, `number clipped at the top edge: ${where}`).toBeGreaterThanOrEqual(t.top);
    expect(n.top, `number above the strip: ${where}`).toBeGreaterThan(s.top);
  });
}

/**
 * T-328: the strip docked above the canvas. Every change of its height moves the canvas's
 * top edge, and without a correction every node would jump by as much -- 58px when showing
 * it, 80px when choosing a moment at desk width, 136px at hand width.
 */
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`A node stays in place while the docked strip changes height at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const world = await seedExampleWorld(page, { open: false });
    await page.goto(`/?world=${world.id}`);
    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    const strip = page.locator(".timeline-strip");
    await expect(strip).toBeVisible();
    const node = page.locator(".story-node").first();
    await expect(node).toBeVisible();
    const position = async () => {
      const box = await node.boundingBox();
      return box ? { x: box.x, y: box.y } : null;
    };
    const near = async (expected: { x: number; y: number } | null, step: string) => {
      const now = await position();
      expect(now, step).not.toBeNull();
      expect(Math.abs((now?.x ?? 0) - (expected?.x ?? 0)), step).toBeLessThanOrEqual(1);
      expect(Math.abs((now?.y ?? 0) - (expected?.y ?? 0)), step).toBeLessThanOrEqual(1);
    };
    const start = await position();
    const heightBefore = (await strip.boundingBox())?.height ?? 0;

    await strip.getByRole("button", { name: world.text("moment.t1.title") }).click();
    await expect.poll(async () => (await strip.boundingBox())?.height ?? 0).not.toBe(heightBefore);
    await near(start, "after choosing a moment");

    await strip.getByRole("button", { name: "Gesamtsicht", exact: true }).click();
    await expect.poll(async () => (await strip.boundingBox())?.height ?? 0).toBe(heightBefore);
    await near(start, "back in the overview");

    const toggle = page.getByRole("button", { name: "Zeit", exact: true });
    await toggle.click();
    await expect(strip).toHaveCount(0);
    await near(start, "after hiding the strip");

    await toggle.click();
    await expect(strip).toBeVisible();
    await near(start, "after showing it again");
  });
}

test("At hand width the strip sits directly on the map and leaves it at least 60%", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const world = await seedExampleWorld(page, { open: false });
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  const strip = page.locator(".timeline-strip");
  await strip.getByRole("button", { name: world.text("moment.t1.title") }).click();
  const [stage, stripBox, map] = await Promise.all([
    page.locator(".figure-stage").boundingBox(),
    strip.boundingBox(),
    page.locator(".figure-stage > .flow-area").boundingBox(),
  ]);
  const where = JSON.stringify({ stage, stripBox, map });
  expect(stage && stripBox && map, where).toBeTruthy();
  if (!stage || !stripBox || !map) return;
  expect(
    Math.abs(map.y - (stripBox.y + stripBox.height)),
    `gap under the strip: ${where}`,
  ).toBeLessThanOrEqual(1);
  expect(map.height / stage.height, `map share: ${where}`).toBeGreaterThanOrEqual(0.6 - 0.005);
});

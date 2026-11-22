import type { Page } from "@playwright/test";
import { seedExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

/**
 * T-326: the timeline strip on the figure board, where the minimap leaves it narrow.
 *
 * The user's screenshot: the first moment "Ankunft im Nordh" cut off by the edge of the
 * track, an empty sliver beside it where the new-moment field had been squeezed, and the
 * moment's number stuck to the top edge. Each width below leaves the strip a different room
 * beside the minimap; at every one of them the strip has to keep its parts readable.
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

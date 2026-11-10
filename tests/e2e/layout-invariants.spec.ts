import type { Page } from "@playwright/test";
import { toolbarRowFindings } from "../audit/support/toolbar-row";
import { mockExampleWorld } from "./support/example-world";
import {
  closePlaceSheet,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  selectMapChild,
  waitForMapViewport,
} from "./support/expanded-map-fixture";
import { waitForSettledLayout } from "./support/layout-settled";
import { expect, test } from "./support/transient-network";
import { WORLD } from "../world/ids.generated";
import type { WorldPart } from "../world/index.mjs";

/*
 * Geometry invariants.
 *
 * The project's other checks see colour, spacing, radius, type, contrast, import boundaries,
 * CSS ownership and story coverage -- but no geometry. That is exactly where the faults of
 * the Werkstatt rebuild sat: a panel that did not fill its grid column; a button outside its
 * card; two floating tools in the same strip; a column handed a view that does not exist
 * there.
 *
 * This file does not check how anything looks, only that nothing sits somewhere it has no
 * business being. That makes it platform independent and free of any pixel baseline.
 */

const TOLERANCE = 1.5;

/**
 * The test world, mocked, in the chosen theme and open in the Werkstatt. The base part is the
 * README world; the edge part adds the check cases, among them the two opened-out maps that
 * the Places tests measure against. A test that only needs a workspace takes the base part.
 */
async function openWorld(
  page: Page,
  { theme = "light", include }: { theme?: "light" | "dark"; include?: readonly WorldPart[] } = {},
) {
  await page.addInitScript((chosen) => {
    localStorage.setItem("quiltor-theme", chosen);
    localStorage.setItem("quiltor-interface-language", "de");
  }, theme);
  await mockExampleWorld(page, include ? { include } : {});
  await page.goto("/?world=example-world");
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
}

/**
 * Zooms out until the cards are drawn as circles. The canvas offers no shortcut for getting
 * there: the figure canvas opens closer in than the place canvas, so this steps until a circle
 * shows, at least six times, and stops at the canvas's own minimum zoom.
 */
async function zoomOutToCircles(page: Page) {
  const zoomOut = page.locator(".react-flow__controls-zoomout");
  const circles = page.locator(".story-node.zoom-overview:not(.is-important)");
  for (let step = 0; step < 12 && (step < 6 || (await circles.count()) === 0); step += 1) {
    if (await zoomOut.isDisabled()) break;
    await zoomOut.click();
    await page.waitForTimeout(120);
  }
  return circles;
}

/** Every violation as one readable line; an empty list is the pass. */
async function violations(page: Page, tolerance: number): Promise<string[]> {
  return page.evaluate((tol) => {
    const found: string[] = [];
    const box = (element: Element) => element.getBoundingClientRect();

    const name = (element: Element) => {
      const classes = (element.className ?? "")
        .toString()
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      const label = element.getAttribute("aria-label");
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${
        label ? ` [${label}]` : ""
      }`;
    };

    const visible = (element: Element) => {
      const rect = box(element);
      if (rect.width < 1 || rect.height < 1) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.opacity !== "0";
    };

    // 1. A panel fills its grid column. Otherwise a dead strip is left beside it that looks
    //    like a fault and is none -- or the panel runs past its track.
    for (const layout of document.querySelectorAll<HTMLElement>(".figure-layout, .text-layout")) {
      const tracks = getComputedStyle(layout)
        .gridTemplateColumns.split(" ")
        .map((value) => Number.parseFloat(value));
      const children = [...layout.children].filter(visible);
      children.forEach((child, index) => {
        const track = tracks[index];
        if (!Number.isFinite(track)) return;
        const width = box(child).width;
        if (Math.abs(width - track) > tol) {
          found.push(
            `${name(child)} is ${width.toFixed(0)}px wide; its grid column is ${track.toFixed(0)}px`,
          );
        }
      });
    }

    // 2. What sits on a card sits on it. A button outside is not merely ugly, it is out of
    //    reach.
    for (const card of document.querySelectorAll(
      ".story-node, .place-map-node, .storyboard-node",
    )) {
      const outer = box(card);
      for (const control of card.querySelectorAll("button")) {
        if (!visible(control)) continue;
        const inner = box(control);
        const escapes =
          inner.left < outer.left - tol ||
          inner.right > outer.right + tol ||
          inner.top < outer.top - tol ||
          inner.bottom > outer.bottom + tol;
        if (escapes) found.push(`${name(control)} is outside ${name(card)}`);
      }
    }

    // 3. Floating tools share an edge, not the same spot.
    const floating = [
      ...document.querySelectorAll(
        ".react-flow__panel.react-flow__controls, .react-flow__panel.react-flow__minimap, .timeline-strip, .place-level-trail, .graph-edge-inspector, .place-map-chrome__header, .place-map-chrome__footer, .places-measure-overlays .mode-banner, .places-measure-overlays .places-scale-legend",
      ),
    ].filter(visible);
    for (let left = 0; left < floating.length; left += 1) {
      for (let right = left + 1; right < floating.length; right += 1) {
        const a = box(floating[left]);
        const b = box(floating[right]);
        const overlaps =
          a.left < b.right - tol &&
          a.right > b.left + tol &&
          a.top < b.bottom - tol &&
          a.bottom > b.top + tol;
        if (overlaps) {
          found.push(`${name(floating[left])} overlaps ${name(floating[right])}`);
        }
      }
    }

    // 4. Chrome does not scroll sideways. When it does, something inside grew too wide.
    //    Clipped surfaces are exempt: there something deliberately reaches past the edge --
    //    a panel's resize grip, say, which has to be grabbable from both sides -- and nobody
    //    can ever lay eyes on it.
    for (const region of document.querySelectorAll(
      ".side-panel, .workspace-toolbar, .status-bar, .app-bar, .place-map-chrome__header, .place-map-chrome__footer",
    )) {
      if (!visible(region)) continue;
      const overflowX = getComputedStyle(region).overflowX;
      if (overflowX === "hidden" || overflowX === "clip") continue;
      if (region.scrollWidth > region.clientWidth + tol) {
        found.push(
          `${name(region)} scrolls horizontally: ${region.scrollWidth}px of content in ${region.clientWidth}px`,
        );
      }
    }

    // 5. Map chrome stays in the canvas and every action fits in its own bar.
    //    Checking the button hit target also catches clipping that bounding boxes miss.
    for (const bar of document.querySelectorAll(
      ".place-map-chrome__header, .place-map-chrome__footer",
    )) {
      if (!visible(bar)) continue;
      const canvas = bar.closest(".places-flow-area");
      if (!canvas) {
        found.push(`${name(bar)} has no Places canvas`);
        continue;
      }
      const outer = box(canvas);
      const bounds = box(bar);
      if (
        bounds.left < outer.left - tol ||
        bounds.right > outer.right + tol ||
        bounds.top < outer.top - tol ||
        bounds.bottom > outer.bottom + tol
      ) {
        found.push(`${name(bar)} escapes the canvas`);
      }
      const controls = [...bar.querySelectorAll("button")].filter(visible);
      for (const control of controls) {
        const rect = box(control);
        if (
          rect.left < bounds.left - tol ||
          rect.right > bounds.right + tol ||
          rect.top < bounds.top - tol ||
          rect.bottom > bounds.bottom + tol
        ) {
          found.push(`${name(control)} escapes ${name(bar)}`);
        }
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        if (!hit || !control.contains(hit)) found.push(`${name(control)} is obscured`);
      }
      for (let first = 0; first < controls.length; first += 1) {
        for (let second = first + 1; second < controls.length; second += 1) {
          const a = box(controls[first]);
          const b = box(controls[second]);
          if (
            a.left < b.right - tol &&
            a.right > b.left + tol &&
            a.top < b.bottom - tol &&
            a.bottom > b.top + tol
          ) {
            found.push(`${name(controls[first])} overlaps ${name(controls[second])}`);
          }
        }
      }
    }

    return found;
  }, tolerance);
}

const workspaces = ["Text", "Figuren", "Timeline", "Orte", "Storyboard"] as const;

// From the project's own width down: each project walks the widths below it, so the compact
// project stays at the phone and the wide one covers every breakpoint in between.
const WIDER_FONT =
  '[role="toolbar"], [role="toolbar"] * { letter-spacing: 0.08em !important; }';

const TOOLBAR_WIDTHS = [
  1440, 1280, 1180, 1100, 1024, 960, 900, 860, 820, 768, 719, 640, 560, 500, 430, 390, 360, 320,
];

for (const viewport of [
  { name: "inspector sheet boundary", width: 820, height: 800, coarse: false },
  { name: "compact controls boundary", width: 719, height: 800, coarse: false },
  { name: "medium chrome boundary", width: 500, height: 844, coarse: false },
  { name: "phone", width: 390, height: 844, coarse: false },
  { name: "coarse pointer", width: 1440, height: 900, coarse: true },
] as const) {
  test(`Expanded map chrome: reachable actions at the ${viewport.name}`, async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "wide",
      "This test owns its explicit viewport and pointer matrix.",
    );
    const context = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.coarse,
      locale: "de-DE",
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("quiltor-interface-language", "de"));
      await mockExpandedMapWorld(page);
      await openExpandedMapWorld(page);
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(
        viewport.coarse,
      );
      await expect(page.locator(".place-map-chrome")).toBeVisible();
      expect(await violations(page, TOLERANCE)).toEqual([]);
      await selectMapChild(page);
      await expect(page.locator(".place-map-chrome")).toBeVisible();
      expect(await violations(page, TOLERANCE)).toEqual([]);
      if (viewport.width === 500) {
        await page
          .locator(".place-map-chrome")
          .getByRole("button", { name: "Maßstab von Weltkarte" })
          .click();
        await page
          .getByRole("dialog", { name: "Maßstab von Weltkarte" })
          .getByRole("textbox", { name: "Einheit" })
          .fill("Seemeilen der Nordküste");
        await page.keyboard.press("Escape");
        expect(await violations(page, TOLERANCE)).toEqual([]);
        await page.screenshot({
          path: testInfo.outputPath("expanded-map-500-long-unit.png"),
          animations: "disabled",
        });
      }

      await page.locator('.react-flow__node[data-id="x-graufurth"]').click();
      if (viewport.width <= 820) {
        const sheet = page.getByRole("dialog", { name: "Orte-Inspector" });
        await expect(sheet).toBeVisible();
        await expect
          .poll(
            async () => {
              const rect = await sheet.boundingBox();
              if (!rect) return null;
              return {
                leftIsInsideViewport: rect.x >= -TOLERANCE,
                rightIsInsideViewport: rect.x + rect.width <= viewport.width + TOLERANCE,
              };
            },
            { message: "The inspector sheet has not finished entering the viewport." },
          )
          .toEqual({ leftIsInsideViewport: true, rightIsInsideViewport: true });
        await closePlaceSheet(page);
      } else {
        await page.getByRole("button", { name: "Auswahl schließen" }).click();
      }
      await waitForMapViewport(page);
      await page
        .locator(".place-map-chrome")
        .getByRole("button", { name: "Bild in Weltkarte anpassen" })
        .click();
      expect(await violations(page, TOLERANCE)).toEqual([]);
      await page
        .locator(".place-map-chrome")
        .getByRole("button", { name: "Bild in Weltkarte fertig anpassen" })
        .click();
      await page.locator(".react-flow__controls-zoomin").click();
      await waitForMapViewport(page);
      expect(await violations(page, TOLERANCE)).toEqual([]);
      const minimapToggle = page.locator(".graph-minimap-toggle");
      await minimapToggle.click();
      await expect(page.locator(".react-flow__minimap")).toHaveCount(0);
      expect(await violations(page, TOLERANCE)).toEqual([]);
      await minimapToggle.click();
      await expect(page.locator(".react-flow__minimap")).toHaveCount(1);
      await expect.poll(() => violations(page, TOLERANCE)).toEqual([]);
      await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
      await expect(page.locator(".places-measure-overlays")).toBeVisible();
      await expect(page.locator(".place-map-chrome")).toBeVisible();
      await expect.poll(() => violations(page, TOLERANCE)).toEqual([]);

      // Inside a level the trail joins the hint and the scale at the top edge. On the top
      // level there is no trail, so only this step can find the three on one spot.
      await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
      await expect(page.locator(".places-measure-overlays")).toHaveCount(0);
      await page
        .locator(".place-map-chrome")
        .getByRole("button", { name: "Weltkarte öffnen", exact: true })
        .click();
      await expect(page.locator(".place-level-trail")).toContainText("Weltkarte");
      await waitForMapViewport(page);
      await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
      await expect(page.locator(".places-measure-overlays")).toBeVisible();
      await expect(page.locator(".place-level-trail")).toBeVisible();
      await expect.poll(() => violations(page, TOLERANCE)).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

for (const workspace of workspaces) {
  test(`${workspace}: nothing lies outside its place`, async ({ page }) => {
    await openWorld(page);

    if (workspace !== "Text") {
      await page.getByRole("button", { name: workspace, exact: true }).click();
    }

    // The control column exists only once something is selected -- without this step the
    // test would check precisely the state in which the interesting panels are missing.
    // Below the column width the controls are a sheet, not a panel; there is nothing to
    // align there, so the step falls away.
    const twoColumns = (page.viewportSize()?.width ?? 0) > 820;
    if (twoColumns && workspace === "Figuren") {
      await page.locator(".world-overview__item").first().click();
      await expect(page.locator(".figure-inspector")).toBeVisible();
    }
    if (twoColumns && workspace === "Orte") {
      await page.locator(".story-node").first().click();
      await expect(page.locator(".places-inspector")).toBeVisible();
    }
    // The canvases fit their viewport on arrival; only after that do the rectangles this
    // measures stand still.
    await waitForSettledLayout(page);

    expect(await violations(page, TOLERANCE)).toEqual([]);
  });

  /*
   * T-104: every toolbar is exactly one row, and none of its controls is hidden or cut off --
   * not wrapped onto a second row (the storyboard's undo alone below the rest), not clipped at
   * the edge ("Element nach vorne"), not under a scrollbar (the manuscript strip). The three
   * project viewports alone missed the storyboard, which wraps between them, so the test walks
   * a row of widths from the widest layout down to the phone.
   */
  for (const theme of ["light", "dark"] as const) {
    test(`${workspace}: every toolbar is one row with nothing hidden (${theme})`, async ({
      page,
    }) => {
      await openWorld(page, { theme });
      if (workspace !== "Text") {
        await page.getByRole("button", { name: workspace, exact: true }).click();
      }
      await waitForSettledLayout(page);
      const start = page.viewportSize() ?? { width: 1440, height: 900 };
      const messages: string[] = [];
      for (const width of TOOLBAR_WIDTHS.filter((candidate) => candidate <= start.width)) {
        await page.setViewportSize({ width, height: start.height });
        await waitForSettledLayout(page);
        for (const finding of await page.evaluate(toolbarRowFindings, TOLERANCE)) {
          messages.push(`${width}px: ${finding.message}`);
        }
      }
      expect(messages).toEqual([]);
    });
  }

  /*
   * T-150: the same rule with text wider than macOS's system font (see T-148 below). A toolbar
   * that only fits Segoe UI or the Linux fonts would wrap or clip on a Mac, where no CI run
   * photographs it.
   */
  test(`${workspace}: every toolbar stays one row with a wider font`, async ({ page }) => {
    await openWorld(page);
    if (workspace !== "Text") {
      await page.getByRole("button", { name: workspace, exact: true }).click();
    }
    // Test-only: roughly 15 percent wider text than Segoe UI, more than the macOS difference.
    await page.addStyleTag({ content: WIDER_FONT });
    await waitForSettledLayout(page);
    const start = page.viewportSize() ?? { width: 1440, height: 900 };
    const messages: string[] = [];
    for (const width of TOOLBAR_WIDTHS.filter((candidate) => candidate <= start.width)) {
      await page.setViewportSize({ width, height: start.height });
      await waitForSettledLayout(page);
      for (const finding of await page.evaluate(toolbarRowFindings, TOLERANCE)) {
        messages.push(`${width}px: ${finding.message}`);
      }
    }
    expect(messages).toEqual([]);
  });
}

/*
 * T-148: the timeline toolbar was one row at 768px on Windows and Linux and two on macOS,
 * whose system font runs wider. A fix tuned to one font's widths breaks on the next, so this
 * forces text wider than macOS's onto the toolbar and asks for one row all the same.
 *
 * The toolbar carries the test world's own calendar (T-218). Its name, "Gezeitenrechnung", is
 * far longer than the label of relative time, and at 900 and 860px the strip used to scroll
 * its create buttons over undo and redo. Each width therefore checks the row rules and then
 * asks the page what is actually under undo and redo.
 */
test("Timeline: the toolbar with a custom calendar keeps undo and redo in view with a wider font", async ({
  page,
}) => {
  await openWorld(page);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.locator(".timeline-toolbar")).toContainText("Gezeitenrechnung");
  // Test-only: roughly 15 percent wider text than Segoe UI, more than the macOS difference.
  await page.addStyleTag({
    content: ".timeline-toolbar, .timeline-toolbar * { letter-spacing: 0.08em !important; }",
  });
  const start = page.viewportSize() ?? { width: 1440, height: 900 };
  const messages: string[] = [];
  for (const width of TOOLBAR_WIDTHS.filter((candidate) => candidate <= start.width)) {
    await page.setViewportSize({ width, height: start.height });
    await waitForSettledLayout(page);
    for (const finding of await page.evaluate(toolbarRowFindings, TOLERANCE)) {
      messages.push(`${width}px: ${finding.message}`);
    }
    for (const name of ["Timeline rückgängig", "Timeline wiederholen"]) {
      const covered = await page.getByRole("button", { name, exact: true }).evaluate((button) => {
        const box = button.getBoundingClientRect();
        const toolbar = button.closest(".timeline-toolbar")?.getBoundingClientRect();
        if (!toolbar || box.width === 0) return "not rendered";
        if (box.left < toolbar.left - 0.5 || box.right > toolbar.right + 0.5) {
          return `outside the toolbar (${Math.round(box.left)}-${Math.round(box.right)})`;
        }
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return hit && button.contains(hit)
          ? ""
          : `covered by ${hit?.closest("[class]")?.className}`;
      });
      if (covered) messages.push(`${width}px: ${name} is ${covered}`);
    }
  }
  expect(messages).toEqual([]);
});

/*
 * A menu lies on top of whatever it was opened from.
 *
 * The fault behind this could not be seen, only measured: the app bar's overflow menu sat at
 * --z-popover: 30, the assistant drawer at --z-drawer-panel: 70. With the drawer open the
 * menu therefore opened invisibly behind it -- aria-expanded said "true", focus was inside,
 * and there was nothing to see. Any check that only reads state calls that correct; only the
 * question "what is actually at this point?" finds it.
 */
test("Menus lie above the opened drawer", async ({ page }) => {
  await openWorld(page);

  test.skip(
    (page.viewportSize()?.width ?? 0) <= 820,
    "Schmal ist die Schublade ein Sheet und verdraengt das Menue, statt neben ihm zu stehen.",
  );

  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  await page.getByRole("button", { name: "Mehr" }).click();

  const menu = page.locator(".ui-popover");
  await expect(menu).toBeVisible();

  const obscured = await page.evaluate(() => {
    const popover = document.querySelector(".ui-popover");
    if (!popover) return "no menu in the tree";
    const box = popover.getBoundingClientRect();
    // Not the middle: a gap between two entries can sit there. A point just below the top
    // edge always lands on the first entry.
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 12);
    if (!hit) return "nothing occupies this position";
    return popover.contains(hit) ? "" : `obscured by ${hit.tagName.toLowerCase()}.${hit.className}`;
  });

  expect(obscured).toBe("");
});

/*
 * A monogram sits in the middle of its circle.
 *
 * Zoomed out, a card shrinks to a 32 pixel circle with a single letter in it -- the only thing
 * left of the element. The map card once pushed its text 38 percent to the right, and after
 * that the capital still sat low (T-130): with `line-height: 1` the box that gets centred is
 * the font's ascent plus descent, and a capital fills only the part above the baseline. A text
 * range reports that font box, not the ink, so the letter is measured with the canvas metrics
 * of the font it is drawn in, placed on the range's baseline.
 */
async function monogramOffsets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const found: string[] = [];
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return ["no 2d canvas context"];
    for (const node of document.querySelectorAll<HTMLElement>(
      ".story-node.zoom-overview:not(.is-important)",
    )) {
      const monogram = node.querySelector<HTMLElement>(".node-monogram");
      const text = monogram?.textContent ?? "";
      if (!monogram || !text) continue;
      const style = getComputedStyle(monogram);
      if (style.display === "none") continue;
      // The font box comes rounded to whole pixels, as the line layout uses it. The ink is
      // measured a thousand times larger, because at 12px canvas rounds it to whole pixels too.
      const fontSize = Number.parseFloat(style.fontSize);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const ascent = context.measureText(text).fontBoundingBoxAscent;
      context.font = `${style.fontWeight} 1000px ${style.fontFamily}`;
      const ink = context.measureText(text);
      const unit = fontSize / 1000;
      const box = node.getBoundingClientRect();
      const scale = box.width / node.offsetWidth;
      const range = document.createRange();
      range.selectNodeContents(monogram);
      const line = range.getBoundingClientRect();
      const baseline = line.top + ascent * scale;
      const inkX =
        line.left + ((ink.actualBoundingBoxRight - ink.actualBoundingBoxLeft) / 2) * unit * scale;
      const inkY =
        baseline +
        ((ink.actualBoundingBoxDescent - ink.actualBoundingBoxAscent) / 2) * unit * scale;
      const dx = inkX - (box.left + box.width / 2);
      const dy = inkY - (box.top + box.height / 2);
      // Across, a letter may stand up to a pixel aside: a K's ink sits off its own advance by
      // design. Up and down it is half a pixel: the capital sat 0.78px low, which at 1x lands
      // a whole device pixel off, and the trimmed box snaps well inside half a pixel.
      if (Math.abs(dx) > 1 || Math.abs(dy) > 0.5) {
        found.push(`${text} is off centre by x ${dx.toFixed(1)}px, y ${dy.toFixed(1)}px`);
      }
    }
    return found;
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const workspace of ["Orte", "Figuren"] as const) {
    test(`${workspace} (${theme}): monograms sit centred in the circle`, async ({ page }) => {
      await openWorld(page, { theme });
      await page.getByRole("button", { name: workspace, exact: true }).click();

      const circles = await zoomOutToCircles(page);
      if (workspace === "Orte") {
        await expect(page.locator(".story-node.zoom-overview.is-map")).toHaveCount(1);
      }
      await expect(circles.locator(".node-monogram").first()).toBeVisible();

      expect(await monogramOffsets(page)).toEqual([]);
    });
  }
}

/*
 * In the overview a figure shows no connection handles until the pointer is on it.
 *
 * StoryGraph.css hides them there, but on the figure board a rule of the same weight from
 * FigureCanvas.css came later and left them at a fifth of their colour. Small, translucent and
 * on fractional positions, they lay across the seams of overlapping circles, and the runners did
 * not draw them the same way twice: the favourites baseline moved by 27 pixels from one run to
 * the next (T-129 F3). The place overview draws no handles at all.
 */
test("Figures: the overview shows no connection handles until a marker is pointed at", async ({
  page,
}) => {
  await openWorld(page);
  await page.getByRole("button", { name: "Figuren", exact: true }).click();

  const circles = await zoomOutToCircles(page);
  await expect(circles.first()).toBeVisible();
  const handles = page.locator(".story-node.zoom-overview .react-flow__handle");
  // Otherwise an empty list below would prove nothing.
  expect(await handles.count()).toBeGreaterThan(0);

  const shown = () =>
    handles.evaluateAll((all) =>
      all
        .filter((handle) => getComputedStyle(handle).opacity !== "0")
        .map((handle) => handle.closest(".react-flow__node")?.getAttribute("data-id") ?? "?"),
    );
  await expect.poll(shown).toEqual([]);

  // The counter-check needs a circle the pointer can reach. On the narrow screen the open
  // timeline strip covers the whole cluster, so it runs in the wider projects only.
  if (test.info().project.name === "compact") return;
  const free = await circles.evaluateAll((all) =>
    all.findIndex((circle) => {
      const box = circle.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit !== null && circle.contains(hit);
    }),
  );
  expect(free).toBeGreaterThanOrEqual(0);
  await circles.nth(free).hover();
  const pointedAt = page.locator(".story-node:hover .directed-handle").first();
  await expect
    .poll(() => pointedAt.evaluate((handle) => getComputedStyle(handle).opacity))
    .toBe("1");
});

/*
 * The minimap shows what stands on the canvas.
 *
 * It showed the opened-out map and left out everything standing on it. The reason is not in
 * the drawing: React Flow only takes nodes into the minimap that bring a size along
 * (`nodeHasDimensions`). A map states its own; an ordinary place card can be measured -- and
 * that measurement is delivered to the node the flow holds in its own list. But places on a
 * map are derived from the map and are not in that list, so their measurement went nowhere.
 *
 * Counting therefore happens against the canvas rather than against a fixed number: what
 * stands there belongs in the overview too.
 */
test("Places: the minimap also shows what stands on a map", async ({ page }) => {
  await openWorld(page, { include: ["base", "edge"] });
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  // Below the column width the canvas hides its minimap; there is then
  // nichts zu vergleichen.
  test.skip((page.viewportSize()?.width ?? 0) <= 719, "The compact layout has no minimap.");
  await expect(page.locator(".react-flow__minimap")).toBeVisible();

  // Only once it is opened out are there any places standing on a map; the check part of the
  // world opens two out.
  await expect(page.locator(".react-flow__node-placeMap")).toHaveCount(2);
  await waitForSettledLayout(page);

  const counts = await page.evaluate(() => ({
    canvas: document.querySelectorAll(".react-flow__node").length,
    overview: document.querySelectorAll(".react-flow__minimap-node").length,
  }));

  expect(counts.canvas).toBeGreaterThan(2);
  expect(counts.overview).toBe(counts.canvas);
});

/*
 * A connection inside a group can be clicked.
 *
 * A group is not a see-through frame but a large card with a body of its own. React Flow puts
 * edges without a layer of their own at 0, groups sit there as well, and at equal rank the
 * node drawn later wins -- the click landed on the group.
 *
 * The measurement uses a point that really lies on the path. The centre of the bounding box
 * does not, for a curved edge, and would have fallen in the middle of a card here: the test
 * would have been red, but for the wrong reason.
 */
test("Storyboard: a connection inside a group can be reached", async ({ page }) => {
  await openWorld(page);
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  // The connection from the turning point to its chapter: inside the second act's group, and
  // without a label, which would otherwise sit on the very point this measures. The world
  // types no ids for board connections, so this one is named by hand.
  const edgeId = "board-edge-four";
  const edge = page.locator(`.react-flow__edge[data-id="${edgeId}"]`);
  await expect(edge).toHaveCount(1);
  await waitForSettledLayout(page);

  const spot = await page.evaluate((id) => {
    const path = document.querySelector<SVGPathElement>(
      `.react-flow__edge[data-id="${id}"] .react-flow__edge-interaction`,
    );
    if (!path) return null;
    const point = path.getPointAtLength(path.getTotalLength() / 2);
    const screen = path.getScreenCTM();
    if (!screen) return null;
    const at = point.matrixTransform(screen);
    const hit = document.elementFromPoint(at.x, at.y);
    return {
      x: at.x,
      y: at.y,
      onTheEdge: Boolean(hit?.closest(".react-flow__edge")),
      obscuredBy: hit?.closest(".react-flow__node")?.getAttribute("data-id") ?? null,
      // When narrow, the library lies over the canvas. The question of group-versus-edge
      // order makes no sense there -- at this point there is no canvas at all. Without this
      // note the test would be red, but for a different reason.
      overTheCanvas: Boolean(hit?.closest(".react-flow")),
    };
  }, edgeId);

  expect(spot).not.toBeNull();
  test.skip(
    !spot?.overTheCanvas,
    "The compact library covers the canvas, leaving no canvas at this position.",
  );

  expect(spot?.obscuredBy).toBeNull();
  expect(spot?.onTheEdge).toBe(true);

  // And the click arrives: selecting opens the controls for the connection.
  await page.mouse.click(spot?.x ?? 0, spot?.y ?? 0);
  await expect(page.locator(".graph-edge-inspector-panel")).toBeVisible();

  // The edge still lies behind the cards -- it should run underneath them, not across.
  const overTheCard = await page.evaluate((id) => {
    const card = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`);
    if (!card) return "no card";
    const box = card.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit?.closest(".react-flow__edge") ? "edge overlaps the card" : "";
  }, WORLD.cards.noteTurn);
  expect(overTheCard).toBe("");
});

/*
 * A place on a map follows the pointer.
 *
 * The anchor says where the place stands. It was stored from the card's centre but drawn as
 * its top-left corner -- so every drag moved the place an extra half card down and to the
 * right. Measured: a 100px drag moved it 188 in x and 135 in y, half a card's width and
 * height too far.
 *
 * The framed map can clip part of a card while its anchor is still on the visible sheet. The
 * test starts on that visible part and requires the card's centre to land on the release point.
 */
test("Places: a place on a map follows the pointer", async ({ page }) => {
  await openWorld(page, { include: ["base", "edge"] });
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  const map = page.locator(`.react-flow__node-placeMap[data-id="${WORLD.figures.xWeltkarte}"]`);
  await expect(map).toBeVisible();
  await waitForSettledLayout(page);

  // The map frame clips the part of the sheet that falls below the canvas, and at the initial
  // fit a card's centre can sit behind the frame footer, where a pointer aimed at it correctly
  // hits the chrome instead of the card. One zoom step reveals the card before testing its drag.
  await page.locator(".react-flow__controls-zoomout").click();

  // The drag has to stay on the map, or the test measures a reparent to another level
  // rather than the movement. On narrow windows the map is too small for that.
  const mapBox = await map.boundingBox();
  test.skip(
    !mapBox || mapBox.width < 240 || mapBox.height < 240,
    "Die aufgeklappte Karte ist hier zu klein, um darauf zu ziehen.",
  );

  const steg = page.locator(`.react-flow__node[data-id="${WORLD.figures.xGraufurth}"]`);
  // The grab point lies on the card's top edge, halfway across, measured from the card itself:
  // a fixed pixel offset lands beside the card once a smaller fit zoom shrinks it (T-220).
  await expect(steg).toBeVisible();
  const before = await steg.boundingBox();
  expect(before).not.toBeNull();
  const grab = { x: before!.width / 2, y: 4 };
  // This waits for the zoom animation and proves that the exact grab point is not covered by
  // either the map or its frame. Capture screen geometry only after that stable point exists.
  await steg.click({ position: grab, trial: true });
  const box = await steg.boundingBox();
  expect(box).not.toBeNull();
  const border = await steg.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      left: Number.parseFloat(style.borderLeftWidth) || 0,
      top: Number.parseFloat(style.borderTopWidth) || 0,
    };
  });
  const drag = 40;
  const start = {
    x: box!.x + border.left + grab.x,
    y: box!.y + border.top + grab.y,
  };
  const target = { x: start.x + drag, y: start.y + drag };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 40 });
  await page.mouse.up();
  await waitForSettledLayout(page);

  const after = await steg.boundingBox();
  expect(after).not.toBeNull();
  const dx = after!.x + after!.width / 2 - target.x;
  const dy = after!.y + after!.height / 2 - target.y;
  const deviation = `x=${dx.toFixed(1)} y=${dy.toFixed(1)} from the pointer`;
  // Keep the margin below 8px: half a card would be 100 in x and 48 in y.
  expect(Math.abs(dx), deviation).toBeLessThan(8);
  expect(Math.abs(dy), deviation).toBeLessThan(8);
});

/*
 * The search field and the search button stand on one line.
 *
 * A field carries the distance to the next form field below itself. In the writing aid's
 * search row there is none below but a button beside it -- that distance made the grid row
 * 16px taller than the input, and the centring referred to this over-tall row. The button
 * sat eight pixels too low and looked as if it were hanging out.
 */
test("Text: the writing aid's search button sits on the line of its field", async ({ page }) => {
  await openWorld(page);

  await waitForSettledLayout(page);
  const schreibhilfe = page.getByRole("radio", { name: "Schreibhilfe" });
  test.skip(
    !(await schreibhilfe.isVisible()),
    "No writing aid is present without the controls column.",
  );
  await schreibhilfe.click();
  await expect(page.locator(".writing-search")).toBeVisible();

  const offset = await page.evaluate(() => {
    const row = document.querySelector(".writing-search");
    const input = row?.querySelector("input");
    const button = row?.querySelector(".writing-search__submit");
    if (!input || !button) return "Suchzeile unvollstaendig";
    const e = input.getBoundingClientRect();
    const k = button.getBoundingClientRect();
    const distance = Math.abs(e.top + e.height / 2 - (k.top + k.height / 2));
    return distance > 1.5 ? `Knopf ${distance.toFixed(1)}px neben der Mitte des Feldes` : "";
  });

  expect(offset).toBe("");
});

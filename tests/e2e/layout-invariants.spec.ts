import { expect, type Page, test } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";
import {
  closePlaceSheet,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  selectMapChild,
  waitForMapViewport,
} from "./support/expanded-map-fixture";

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

const manuscript = {
  chapters: [
    {
      id: "c1",
      title: "Die Ankunft",
      body: "Der Morgen lag still über dem Hafen. Zwischen den Masten schimmerte das Archiv.",
      note: "Die Unruhe der Stadt nur andeuten.",
    },
    { id: "c2", title: "Das Archiv", body: "Acht Wörter stehen hier schon bereit.", note: "" },
  ],
  words: [],
  activeSymbols: [],
};

const figures = {
  nodes: [
    {
      id: "mara",
      x: 120,
      y: 120,
      type: "person" as const,
      name: "Mara Venn",
      label: "Kartographin",
      sub: "Liest lebende Karten.",
    },
    {
      id: "archiv",
      x: 460,
      y: 300,
      type: "ort" as const,
      name: "Gezeitenarchiv",
      label: "Ort",
      sub: "Ein gläserner Bau am Hafen.",
      mapX: 35,
      mapY: 45,
    },
    {
      id: "gilde",
      x: 460,
      y: 120,
      type: "organisation" as const,
      name: "Kartographengilde",
      label: "Organisation",
      sub: "Kontrolliert die Seewege.",
    },
    {
      id: "hafenkarte",
      x: 120,
      y: 300,
      type: "ort" as const,
      name: "Nordhafen",
      label: "Ort",
      sub: "Eine begehbare Karte.",
      mapImageId: "karte-1",
      mapExpanded: true,
      mapWidth: 800,
      mapHeight: 600,
    },
    // A folded-up map. It is here because an opened-out map is no longer a card but ground:
    // it is drawn as a surface, never as a little card, and so it does not shrink to a circle
    // when zoomed out either. Measuring a map's monogram needs one that is still folded.
    {
      id: "werftplan",
      x: 700,
      y: 300,
      type: "ort" as const,
      name: "Werftplan",
      label: "Ort",
      sub: "Eine gefaltete Karte.",
      mapImageId: "karte-2",
    },
    // Two places that stand on the map rather than on the level: they appear only once the
    // map is opened out, and are then derived from it rather than stored.
    {
      id: "steg",
      x: 0,
      y: 0,
      type: "ort" as const,
      name: "Steg",
      label: "Ort",
      sub: "Auf der Karte.",
      parentPlaceId: "hafenkarte",
      mapU: 0.3,
      mapV: 0.4,
    },
    {
      id: "kran",
      x: 0,
      y: 0,
      type: "ort" as const,
      name: "Kran",
      label: "Ort",
      sub: "Auch auf der Karte.",
      parentPlaceId: "hafenkarte",
      mapU: 0.7,
      mapV: 0.6,
    },
  ],
  edges: [{ id: "e1", from: "mara", to: "archiv", label: "hütet", directed: true }],
  timeline: [{ id: "t1", title: "Ankunft", date: "1847-09-03", note: "Mara erreicht den Hafen." }],
  presence: [],
};

const storyboards = {
  boards: [{ id: "main-storyboard", title: "Erster Entwurf" }],
  nodes: [
    {
      id: "gruppe",
      boardId: "main-storyboard",
      kind: "group" as const,
      x: 0,
      y: 0,
      width: 620,
      height: 420,
      label: "Erster Akt",
    },
    {
      id: "karte-a",
      boardId: "main-storyboard",
      kind: "note" as const,
      x: 60,
      y: 80,
      text: "Ankunft im Hafen.",
    },
    {
      id: "karte-b",
      boardId: "main-storyboard",
      kind: "note" as const,
      x: 380,
      y: 80,
      text: "Aufbruch ins Archiv.",
    },
  ],
  edges: [
    {
      id: "kante-1",
      boardId: "main-storyboard",
      sourceNodeId: "karte-a",
      targetNodeId: "karte-b",
      directed: true,
    },
  ],
};

async function mockWorkshop(page: Page) {
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "layout" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  const world = {
    id: "layout",
    title: "Der gläserne Atlas",
    backupUrl: "",
    updated: "2026-09-03T12:00:00Z",
  };
  await page.route("**/api/worlds", (route) =>
    route.fulfill({ json: { ok: true, worlds: [world] } }),
  );
  await page.route("**/api/worlds/open", (route) => route.fulfill({ json: { ok: true, world } }));
  await mockRequiredWorldDocuments(page, { manuscript, storyWorld: figures, storyboards });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: false, mode: "local", reason: "-", chunks: 0 },
    }),
  );
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

      await page.locator('.react-flow__node[data-id="graufurth"]').click();
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
    } finally {
      await context.close();
    }
  });
}

for (const workspace of workspaces) {
  test(`${workspace}: nothing lies outside its place`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("quiltor-theme", "light");
      localStorage.setItem("quiltor-interface-language", "de");
    });
    await mockWorkshop(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
    await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

    if (workspace !== "Text") {
      await page.getByRole("button", { name: workspace, exact: true }).click();
    }

    // The control column exists only once something is selected -- without this step the
    // test would check precisely the state in which the interesting panels are missing.
    // Below the column width the controls are a sheet, not a panel; there is nothing to
    // align there, so the step falls away.
    const spalten = (page.viewportSize()?.width ?? 0) > 820;
    if (spalten && workspace === "Figuren") {
      await page.locator(".world-overview__item").first().click();
      await expect(page.locator(".figure-inspector")).toBeVisible();
    }
    if (spalten && workspace === "Orte") {
      await page.locator(".story-node").first().click();
      await expect(page.locator(".places-inspector")).toBeVisible();
    }
    // The canvases fit their viewport on arrival; only after that do the rectangles this
    // measures stand still.
    await page.waitForTimeout(900);

    expect(await violations(page, TOLERANCE)).toEqual([]);
  });
}

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
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

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
 * Zoomed out, a place card shrinks to 32 pixels with a single letter in it. The map card kept
 * pushing its text 38 percent to the right -- the column next to the preview image, which
 * does not exist at all at that size. Ten pixels off the centre of a circle is obvious at a
 * glance, and yet there was nowhere to measure it.
 */
test("Places: monograms sit centred in the circle", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  // The circle appears only far out; the canvas offers no shortcut for getting there.
  const zoomOut = page.locator(".react-flow__controls-zoomout");
  for (let step = 0; step < 6; step += 1) {
    await zoomOut.click();
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".story-node.zoom-overview.is-map")).toHaveCount(1);

  const offset = await page.evaluate(() => {
    const found: string[] = [];
    for (const node of document.querySelectorAll(".story-node.zoom-overview")) {
      const monogram = node.querySelector(".node-monogram");
      if (!monogram) continue;
      const box = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(monogram);
      const ink = range.getBoundingClientRect();
      const offset = ink.left + ink.width / 2 - (box.left + box.width / 2);
      if (Math.abs(offset) > 1.5) {
        found.push(`${monogram.textContent} steht ${offset.toFixed(1)}px neben der Mitte`);
      }
    }
    return found;
  });

  expect(offset).toEqual([]);
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
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  // Below the column width the canvas hides its minimap; there is then
  // nichts zu vergleichen.
  test.skip((page.viewportSize()?.width ?? 0) <= 719, "The compact layout has no minimap.");
  await expect(page.locator(".react-flow__minimap")).toBeVisible();

  // Only once it is opened out are there any places standing on a map.
  await expect(page.locator(".react-flow__node-placeMap")).toHaveCount(1);
  await page.waitForTimeout(900);

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
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await page.waitForTimeout(600);

  const spot = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>(".react-flow__edge-interaction");
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
  });

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
  const overTheCard = await page.evaluate(() => {
    const card = document.querySelector<HTMLElement>('.react-flow__node[data-id="karte-a"]');
    if (!card) return "no card";
    const box = card.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return hit?.closest(".react-flow__edge") ? "edge overlaps the card" : "";
  });
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
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await expect(page.locator(".react-flow__node-placeMap")).toHaveCount(1);
  await page.waitForTimeout(900);

  // The map frame clips the part of the sheet that falls below the canvas. At the initial
  // fit, Steg's centre is behind the frame footer, so a pointer aimed there correctly hits
  // the chrome instead of the card. One zoom step reveals the card before testing its drag.
  await page.locator(".react-flow__controls-zoomout").click();

  // The drag has to stay on the map, or the test measures a reparent to another level
  // rather than the movement. On narrow windows the map is too small for that.
  const map = await page.locator(".react-flow__node-placeMap").boundingBox();
  test.skip(
    !map || map.width < 240 || map.height < 240,
    "Die aufgeklappte Karte ist hier zu klein, um darauf zu ziehen.",
  );

  const steg = page.locator('.react-flow__node[data-id="steg"]');
  // This waits for the zoom animation and proves that the exact grab point is not covered by
  // either the map or its frame. Capture screen geometry only after that stable point exists.
  const grab = { x: 100, y: 4 };
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
  await page.waitForTimeout(900);

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
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

  await page.waitForTimeout(900);
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

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/transient-network";
import {
  fulfillDocumentSave,
  fulfillManuscript,
  mockWorkshop as mockWorkshopRoutes,
} from "./support/application-api";
import {
  mockExpandedMapWorld,
  openExpandedMapWorld,
  selectMapChild,
} from "./support/expanded-map-fixture";

const manuscript = {
  chapters: [
    {
      id: "c1",
      title: "Die Ankunft",
      body: "Der Morgen lag still über dem Hafen. Mara öffnete die Karte.",
      note: "Die Unruhe nur andeuten.",
    },
  ],
  words: [],
  activeSymbols: ["„", "“", "…"],
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
      x: 480,
      y: 260,
      type: "ort" as const,
      name: "Gezeitenarchiv",
      label: "Ort",
      sub: "Ein gläserner Bau am Hafen.",
      mapX: 35,
      mapY: 45,
    },
  ],
  edges: [{ id: "e1", from: "mara", to: "archiv", label: "sucht", directed: true }],
  timeline: [{ id: "t1", title: "Ankunft", date: "1847-09-03", note: "Mara erreicht den Hafen." }],
  presence: [],
};

function mockWorkshop(page: Page) {
  return mockWorkshopRoutes(page, {
    version: "baseline",
    world: {
      id: "baseline",
      title: "Der gläserne Atlas",
      backupUrl: "",
      updated: "2026-08-09T12:00:00Z",
    },
    documents: { manuscript, storyWorld: figures },
    assistant: { reason: "Baseline", chunks: 3 },
  });
}

const SNAPSHOTS = join(
  dirname(fileURLToPath(import.meta.url)),
  "visual-baseline.spec.ts-snapshots",
);

/**
 * Whether this platform has anything to compare at all.
 *
 * Baselines are versioned per platform -- Playwright appends darwin, linux or win32 to the
 * file names, because font rasterisation differs. The comparison used to run on macOS only,
 * where no job executed it: green everywhere, checked nowhere. It now runs everywhere and
 * steps aside only where nobody has produced a set yet -- which platform that is,
 * check_visual_baseline_reach.mjs reports.
 */
function hasBaselines() {
  return existsSync(join(SNAPSHOTS, `light-manuscript-wide-${process.platform}.png`));
}

/**
 * The generation pass of the visual-baselines-bootstrap workflow.
 *
 * It runs only with --update-snapshots=missing, so it writes exclusively images that do not
 * exist yet and leaves existing references alone. Without this concession the skip above
 * would keep a first set from ever coming into being -- the run would skip itself.
 */
const BOOTSTRAP = process.env.QUILTOR_BASELINE_BOOTSTRAP === "1";

/*
 * A few pixels of leniency -- but only on the two canvases.
 *
 * At the left edge a card stands half outside the viewport. Its antialiased edge comes out
 * one or two pixels differently from run to run; waiting for the canvas to settle made that
 * rarer but did not remove it. A real design deviation moves thousands of pixels here, not
 * two -- the threshold separates them safely.
 */
const CANVAS_TOLERANCE = { maxDiffPixels: 24 } as const;

/*
 * Wait until the canvas stands still.
 *
 * React Flow fits the viewport only once it has measured its nodes. Whoever photographs at
 * once sometimes catches the frame before -- and then a card at the edge lies one pixel
 * elsewhere than in the reference. That looked like a design deviation and was a snapshot.
 * What is waited for is two identical transforms in a row.
 */
async function waitForCanvasToSettle(page: Page) {
  const viewport = page.locator(".flow-area .react-flow__viewport").first();
  if ((await viewport.count()) === 0) return;
  let vorige: string | null = null;
  await expect
    .poll(
      async () => {
        const jetzt = await viewport.getAttribute("style");
        const ruhig = jetzt !== null && jetzt === vorige;
        vorige = jetzt;
        return ruhig;
      },
      { message: "Die Leinwand passt ihren Ausschnitt noch an." },
    )
    .toBe(true);
}

/*
 * Fit the canvas until the fit no longer moves it.
 *
 * On a compact screen a story card keeps a touch-sized height that depends on the zoom
 * (StoryNodeCard: storyNodeCompactLayoutHeight). One fit measures the cards at the old zoom,
 * sets a new one, and the cards then shrink by a fraction of a pixel. Whether React Flow had
 * measured that before the fit decided where the viewport ended up: 0.3 px apart in y, which
 * moved every grid line and card edge and failed the figures baseline about one run in ten.
 * Fitting again with the settled sizes reaches the same transform every time.
 */
async function fitUntilSettled(page: Page) {
  const viewport = page.locator(".flow-area .react-flow__viewport").first();
  const fitView = page.locator(".figure-workspace .react-flow__controls-fitview");
  let previous: string | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await fitView.click();
    await waitForCanvasToSettle(page);
    const current = await viewport.getAttribute("style");
    if (current !== null && current === previous) return;
    previous = current;
  }
  throw new Error("Fitting the canvas did not settle on one transform.");
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: expanded map chrome remains attached while editing places`, async ({ page }) => {
    test.skip(!BOOTSTRAP && !hasBaselines(), `No baseline set exists for ${process.platform}.`);
    await page.addInitScript((selected) => {
      localStorage.setItem("quiltor-theme", selected);
      localStorage.setItem("quiltor-interface-language", "de");
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockExpandedMapWorld(page);
    await openExpandedMapWorld(page);
    // Reopening establishes the same idle save state in development and production. R1:
    // loading no longer re-saves, so the status reads "Bereit" rather than "Gespeichert".
    // Await it before arranging the compact navigation, whose width depends on this label.
    await page.getByRole("button", { name: "Mehr", exact: true }).click();
    await page.getByRole("menuitem", { name: "Zur Weltauswahl", exact: true }).click();
    await page
      .getByRole("button", { name: "Die nördlichen Küsten – Welt öffnen", exact: true })
      .click();
    await expect(page.locator(".places-workspace")).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Bereit");
    await page
      .getByRole("button", { name: "Orte", exact: true })
      .evaluate((element) => element.scrollIntoView({ block: "nearest", inline: "center" }));
    await selectMapChild(page);
    await expect(page.locator('.place-map-chrome[data-map-id="x-weltkarte"]')).toBeVisible();
    await expect(page.locator(".place-map-chrome__footer")).toContainText("25 km");
    await expect(page).toHaveScreenshot(`${theme}-expanded-map.png`, {
      animations: "disabled",
      ...CANVAS_TOLERANCE,
    });
  });

  test(`${theme}: the core views stay visually reproducible`, async ({ page }) => {
    test.skip(
      !BOOTSTRAP && !hasBaselines(),
      `No baseline set exists for ${process.platform}. Run the ` +
        '"Generate visual baselines" workflow for this branch; subsequent runs compare ' +
        "against the generated baselines.",
    );
    // Missing snapshots fail their assertion even when Playwright writes them. During the
    // bootstrap pass, collect those expected failures so every core view gets a reference;
    // the workflow follows this with a normal hard-assertion comparison before committing.
    const screenshotExpectation = BOOTSTRAP ? expect.soft(page) : expect(page);
    await page.addInitScript((selected) => {
      localStorage.setItem("quiltor-theme", selected);
      localStorage.setItem("quiltor-interface-language", "de");
    }, theme);
    await mockWorkshop(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
    await screenshotExpectation.toHaveScreenshot(`${theme}-world-gate.png`, {
      animations: "disabled",
    });

    await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
    await expect(page.getByLabel("Kapiteltext")).toBeVisible();
    await screenshotExpectation.toHaveScreenshot(`${theme}-manuscript.png`, {
      animations: "disabled",
    });

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) < 720) {
      await expect
        .poll(async () => {
          const workspace = await page.locator(".figure-workspace").boundingBox();
          const canvas = await page.locator(".figure-workspace .flow-area").boundingBox();
          if (!workspace || !canvas) return Number.POSITIVE_INFINITY;
          return Math.abs(workspace.width - canvas.width);
        })
        .toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Ansicht", exact: true }).click();
      await page.getByRole("menuitem", { name: "Zeit ausblenden", exact: true }).click();
      await expect(page.locator(".figure-workspace .timeline-strip")).toHaveCount(0);
      await fitUntilSettled(page);
    }
    await waitForCanvasToSettle(page);
    if ((page.viewportSize()?.width ?? 0) < 720) {
      await expect(
        page.locator('.figure-workspace .react-flow__node[data-id="mara"] .story-node'),
      ).toBeInViewport({ ratio: 0.999999 });
      await expect(
        page.locator('.figure-workspace .react-flow__node[data-id="archiv"] .story-node'),
      ).toBeInViewport({ ratio: 0.999999 });
    }
    await screenshotExpectation.toHaveScreenshot(`${theme}-figures.png`, {
      animations: "disabled",
      ...CANVAS_TOLERANCE,
    });

    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await screenshotExpectation.toHaveScreenshot(`${theme}-timeline.png`, {
      animations: "disabled",
    });

    await page.getByRole("button", { name: "Orte", exact: true }).click();
    await expect(page.locator(".places-workspace")).toBeVisible();
    await waitForCanvasToSettle(page);
    await screenshotExpectation.toHaveScreenshot(`${theme}-places.png`, {
      animations: "disabled",
      ...CANVAS_TOLERANCE,
    });

    await page.keyboard.press("Control+KeyF");
    await expect(page.getByRole("dialog")).toBeVisible();
    await screenshotExpectation.toHaveScreenshot(`${theme}-dialog.png`, {
      animations: "disabled",
    });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
    const assistant =
      (page.viewportSize()?.width || 0) < 720
        ? page.getByRole("dialog", { name: "Lokaler Assistent" })
        : page.getByRole("complementary", { name: "Lokaler Assistent" });
    await expect(assistant).toBeVisible();
    // The compact sheet slides up (ui-sheet-up) and is "visible" from its first frame, still
    // off screen. `animations: "disabled"` finishes the animation just before the capture,
    // but on a loaded macOS runner the capture once showed the sheet 526 px short of its
    // place, both attempts alike (T-77). Let the slide end on its own first.
    await assistant.evaluate((element) =>
      Promise.all(
        element.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    await screenshotExpectation.toHaveScreenshot(`${theme}-assistant.png`, {
      animations: "disabled",
    });
  });
}

/*
 * The overview with favourites (T-129): round markers, two favourites -- one with a short name,
 * one whose long name is cut off -- and a favourite lying over ordinary markers.
 *
 * The overview is the zoom tier below 0.34, and its markers keep their size while the world
 * shrinks. So the positions are laid out in screen units and divided by OVERVIEW_ZOOM: two
 * far-off corner anchors make the fit land close to that zoom in every project, and the
 * cluster between them is spaced tighter than a marker is wide. Nothing is random; the
 * screenshot is the same every run.
 */
const OVERVIEW_ZOOM = 0.25;
const LONG_FAVOURITE = "Die nördliche Hafenmeisterei am äußersten Kai der Gezeitenbucht";
const OVERVIEW_NAMES = [
  "Anselm",
  "Berit",
  "Cornelius",
  "Dorothea",
  "Emil",
  "Frieda",
  "Gesine",
  "Hilmar",
  "Ingrid",
  "Jasper",
  "Kaspar",
  "Lotte",
  "Marthe",
  "Nikolai",
  "Ottilie",
  "Pelle",
  "Quirin",
  "Rosalind",
] as const;

function overviewFavouritesWorld(canvas: { width: number; height: number }) {
  const at = (screenX: number, screenY: number) => ({
    x: Math.round(screenX / OVERVIEW_ZOOM),
    y: Math.round(screenY / OVERVIEW_ZOOM),
  });
  const middle = { x: canvas.width / 2, y: canvas.height / 2 };
  const nodes = [
    // Favourites first in the array: without a z-index every later marker would cover them.
    {
      id: "fav-libelle",
      name: "Libelle",
      type: "ort" as const,
      important: true,
      ...at(middle.x - 40, middle.y - 10),
    },
    {
      id: "fav-lang",
      name: LONG_FAVOURITE,
      type: "ort" as const,
      important: true,
      ...at(middle.x + 20, middle.y + 36),
    },
    { id: "anker-nw", name: "Nordwesten", type: "ort" as const, ...at(20, 20) },
    {
      id: "anker-so",
      name: "Südosten",
      type: "ort" as const,
      ...at(canvas.width - 20, canvas.height - 20),
    },
    ...Array.from({ length: 18 }, (_, index) => ({
      id: `ort-${index}`,
      name: OVERVIEW_NAMES[index],
      type: index % 5 === 0 ? ("person" as const) : ("ort" as const),
      // A tight lattice with a deterministic wobble; the first rows sit under "Libelle".
      ...at(
        middle.x - 100 + (index % 6) * 26 + ((index * 7) % 5),
        middle.y - 40 + Math.floor(index / 6) * 28 + ((index * 11) % 5),
      ),
    })),
  ];
  return { nodes, edges: [], timeline: [], presence: [] };
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the overview keeps favourites above ordinary markers`, async ({ page }) => {
    test.skip(!BOOTSTRAP && !hasBaselines(), `No baseline set exists for ${process.platform}.`);
    await page.addInitScript((selected) => {
      localStorage.setItem("quiltor-theme", selected);
      localStorage.setItem("quiltor-interface-language", "de");
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const viewport = page.viewportSize() ?? { width: 1440, height: 900 };
    await mockWorkshopRoutes(page, {
      version: "baseline",
      world: {
        id: "baseline",
        title: "Der gläserne Atlas",
        backupUrl: "",
        updated: "2026-08-09T12:00:00Z",
      },
      documents: {
        manuscript,
        storyWorld: overviewFavouritesWorld({
          width: viewport.width * 0.8,
          height: viewport.height * 0.6,
        }),
      },
      assistant: { reason: "Baseline", chunks: 3 },
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
    await fitUntilSettled(page);
    await expect(page.locator(".figure-workspace .flow-area")).toHaveClass(/zoom-overview/);
    await expect(page.locator(".figure-workspace .story-node.is-important")).toHaveCount(2);
    await expect(page.locator(".figure-workspace .flow-area")).toHaveScreenshot(
      `${theme}-overview-favourites.png`,
      {
        animations: "disabled",
        ...CANVAS_TOLERANCE,
      },
    );
  });
}

test("Performance baseline for start, workspace switch and a large chapter", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "The performance baseline uses the fixed wide viewport.",
  );
  const large = {
    ...manuscript,
    chapters: [{ ...manuscript.chapters[0], body: "Ein Satz im großen Kapitel. ".repeat(10_000) }],
  };
  await mockWorkshop(page);
  await page.unroute("**/api/manuscript*");
  await page.route("**/api/manuscript*", (route) =>
    route.request().method() === "GET"
      ? fulfillManuscript(route, large)
      : fulfillDocumentSave(route, 1),
  );
  const started = performance.now();
  await page.goto("/?world=baseline");
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  const appStartMs = performance.now() - started;
  const switched = performance.now();
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
  const workspaceSwitchMs = performance.now() - switched;
  const metrics = {
    appStartMs: Math.round(appStartMs),
    workspaceSwitchMs: Math.round(workspaceSwitchMs),
    chapterCharacters: large.chapters[0].body.length,
  };
  await testInfo.attach("performance-baseline.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  expect(metrics.appStartMs).toBeLessThan(5_000);
  expect(metrics.workspaceSwitchMs).toBeLessThan(2_000);
});

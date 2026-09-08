import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import {
  fulfillDocumentSave,
  fulfillManuscript,
  mockRequiredWorldDocuments,
} from "./support/application-api";

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

async function mockWorkshop(page: Page) {
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "baseline" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  await page.route("**/api/worlds", (route) =>
    route.fulfill({
      json: {
        ok: true,
        worlds: [
          {
            id: "baseline",
            title: "Der gläserne Atlas",
            backupUrl: "",
            updated: "2026-08-09T12:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/worlds/open", (route) =>
    route.fulfill({
      json: {
        ok: true,
        world: {
          id: "baseline",
          title: "Der gläserne Atlas",
          backupUrl: "",
          updated: "2026-08-09T12:00:00Z",
        },
      },
    }),
  );
  await mockRequiredWorldDocuments(page, { manuscript, storyWorld: figures });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: false, mode: "local", reason: "Baseline", chunks: 3 },
    }),
  );
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
 * The bootstrap run of the visual-baselines-bootstrap workflow.
 *
 * It runs by hand only and only with --update-snapshots=missing, so it writes exclusively
 * images that do not exist yet and leaves existing references alone. Without this concession
 * the skip above would keep a first set from ever coming into being -- the run would skip
 * itself.
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
const LEINWAND_TOLERANZ = { maxDiffPixels: 24 } as const;

/*
 * Wait until the canvas stands still.
 *
 * React Flow fits the viewport only once it has measured its nodes. Whoever photographs at
 * once sometimes catches the frame before -- and then a card at the edge lies one pixel
 * elsewhere than in the reference. That looked like a design deviation and was a snapshot.
 * What is waited for is two identical transforms in a row.
 */
async function stillstehendeLeinwand(page: Page) {
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

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: the core views stay visually reproducible`, async ({ page }) => {
    test.skip(
      !BOOTSTRAP && !hasBaselines(),
      `Fuer ${process.platform} liegt noch kein Baseline-Satz vor. Einmal mit ` +
        "`npx playwright test tests/e2e/visual-baseline.spec.ts --update-snapshots` " +
        "erzeugen und einchecken; danach vergleicht dieser Lauf.",
    );
    await page.addInitScript((selected) => {
      localStorage.setItem("quiltor-theme", selected);
      localStorage.setItem("quiltor-interface-language", "de");
    }, theme);
    await mockWorkshop(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-world-gate.png`, { animations: "disabled" });

    await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
    await expect(page.getByLabel("Kapiteltext")).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-manuscript.png`, { animations: "disabled" });

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
    await stillstehendeLeinwand(page);
    await expect(page).toHaveScreenshot(`${theme}-figures.png`, {
      animations: "disabled",
      ...LEINWAND_TOLERANZ,
    });

    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-timeline.png`, { animations: "disabled" });

    await page.getByRole("button", { name: "Orte", exact: true }).click();
    await expect(page.locator(".places-workspace")).toBeVisible();
    await stillstehendeLeinwand(page);
    await expect(page).toHaveScreenshot(`${theme}-places.png`, {
      animations: "disabled",
      ...LEINWAND_TOLERANZ,
    });

    await page.keyboard.press("Control+KeyF");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-dialog.png`, { animations: "disabled" });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
    const assistant =
      (page.viewportSize()?.width || 0) < 720
        ? page.getByRole("dialog", { name: "Lokaler Assistent" })
        : page.getByRole("complementary", { name: "Lokaler Assistent" });
    await expect(assistant).toBeVisible();
    await expect(page).toHaveScreenshot(`${theme}-assistant.png`, { animations: "disabled" });
  });
}

test("Performance baseline for start, workspace switch and a large chapter", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Die Performance-Baseline wird im festen Wide-Viewport gemessen.",
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

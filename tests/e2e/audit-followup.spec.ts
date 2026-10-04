import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";
import type { FigureState } from "../../packages/client/src/modules/story-world";
import type { StoryboardState } from "../../packages/client/src/modules/storyboard/model";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { encodeStoryWorldV1 } from "../../packages/client/src/platform/contracts/v1/storyWorld";
import { createTestWorld, expect, test } from "./support/world-fixture";

const docxFixture = new URL("../fixtures/manuscript-import/harbor.docx", import.meta.url);
const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const mapPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAABeK7cBAAAADUlEQVR42mNk+M/wHwAF/gL+5h0XAAAAAElFTkSuQmCC",
  "base64",
);

const storyWorld: FigureState = {
  nodes: [
    { id: "ada", type: "person", name: "Ada", label: "Navigatorin", x: 80, y: 80 },
    {
      id: "nordhafen",
      type: "ort",
      name: "Nordhafen",
      label: "Ort",
      x: 120,
      y: 180,
      mapScale: { unitsPer100px: 25, unitLabel: "km" },
    },
    { id: "suedhafen", type: "ort", name: "Südhafen", label: "Ort", x: 520, y: 180 },
  ],
  edges: [],
  timeline: [],
  presence: [],
};

const storyboards: StoryboardState = {
  boards: [{ id: "main-storyboard", title: "Erster Entwurf" }],
  nodes: [
    {
      id: "gruppe",
      boardId: "main-storyboard",
      kind: "group",
      x: 20,
      y: 20,
      width: 620,
      height: 380,
      label: "Erster Akt",
    },
    {
      id: "karte-a",
      boardId: "main-storyboard",
      kind: "note",
      x: 70,
      y: 90,
      text: "Ankunft im Nordhafen.",
    },
    {
      id: "karte-b",
      boardId: "main-storyboard",
      kind: "note",
      x: 370,
      y: 90,
      text: "Aufbruch zum Archiv.",
    },
  ],
  edges: [
    {
      id: "kante",
      boardId: "main-storyboard",
      sourceNodeId: "karte-a",
      targetNodeId: "karte-b",
      directed: true,
    },
  ],
};

async function putDocument(page: Page, path: string, encode: (revision: number) => unknown) {
  const current = await page.request.get(path);
  expect(current.ok(), await current.text()).toBe(true);
  const revision = Number((current.headers().etag ?? '"0"').replaceAll('"', ""));
  const saved = await page.request.put(path, {
    headers: { "If-Match": `"${revision}"` },
    data: encode(revision),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
}

async function seedAuditWorld(page: Page, title: string) {
  const world = await createTestWorld(page, title);
  await putDocument(page, `/api/manuscript?world=${world.id}`, (revision) =>
    encodeManuscriptV1(
      {
        chapters: [
          {
            id: "anfang",
            title: "Ankunft am Hafen",
            body: "Der Morgen lag still über dem Hafen. Mara hielt den alten Brief fest.",
            note: "Die Unruhe nur andeuten.",
          },
        ],
      },
      revision,
    ),
  );
  await putDocument(page, `/api/state?world=${world.id}`, (revision) =>
    encodeStoryWorldV1(storyWorld, revision),
  );
  await putDocument(page, `/api/storyboards?world=${world.id}`, (revision) =>
    encodeStoryboardsV1(storyboards, revision),
  );
  const snapshot = await page.request.post("/api/backup", {
    data: { worldId: world.id, message: "Vor der Überarbeitung", push: false },
  });
  expect(snapshot.ok(), await snapshot.text()).toBe(true);
  await putDocument(page, `/api/manuscript?world=${world.id}`, (revision) =>
    encodeManuscriptV1(
      {
        chapters: [
          {
            id: "anfang",
            title: "Ankunft am Hafen",
            body: "Der Morgen lag still über dem Hafen. Mara hielt den ungeöffneten Brief fest.",
            note: "Die Unruhe nur andeuten.",
          },
        ],
      },
      revision,
    ),
  );
  return world;
}

async function expectContained(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return Math.max(
          -rect.left,
          rect.right - window.innerWidth,
          document.documentElement.scrollWidth - window.innerWidth,
        );
      }),
    )
    .toBeLessThanOrEqual(1);
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .map((candidate) => ({
          selector: `${candidate.tagName.toLowerCase()}.${candidate.className}`,
          left: candidate.getBoundingClientRect().left,
          right: candidate.getBoundingClientRect().right,
          scrollWidth: candidate.scrollWidth,
          clientWidth: candidate.clientWidth,
        }))
        .filter(
          (candidate) =>
            candidate.right > window.innerWidth + 1 ||
            candidate.left < -1 ||
            candidate.scrollWidth > candidate.clientWidth + 1,
        )
        .sort(
          (first, second) =>
            Math.max(
              second.right - window.innerWidth,
              -second.left,
              second.scrollWidth - second.clientWidth,
            ) -
            Math.max(
              first.right - window.innerWidth,
              -first.left,
              first.scrollWidth - first.clientWidth,
            ),
        )
        .slice(0, 12),
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
  expect(
    geometry.documentWidth,
    `overflowing elements: ${JSON.stringify(geometry.offenders)}`,
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth + 1));
}

async function expectFrameContained(locator: Locator, page: Page) {
  await expect(locator).toBeVisible();
  const geometry = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(-1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport + 1);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport + 1);
}

async function capture(page: Page, testInfo: TestInfo, name: string, locator?: Locator) {
  const target = locator ?? page.locator("body");
  await target.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
}

async function exerciseTwoHundredPercentText(page: Page, dialog: Locator) {
  const originalViewport = page.viewportSize();
  if (!originalViewport) throw new Error("The audit requires a fixed viewport.");
  await page.setViewportSize({
    width: originalViewport.width <= 400 ? 320 : Math.floor(originalViewport.width / 2),
    height: originalViewport.height,
  });
  const measurement = await dialog.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    const original = elements.map((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    elements.forEach((element, index) => {
      (element as HTMLElement).style.transition = "none";
      (element as HTMLElement).style.fontSize = `${original[index] * 2}px`;
    });
    return {
      before: original[0],
      after: Number.parseFloat(getComputedStyle(root).fontSize),
    };
  });
  expect(measurement.after).toBeCloseTo(measurement.before * 2, 1);
  await expectContained(dialog, page);
  return originalViewport;
}

async function openImportPreview(page: Page) {
  await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/manuscript-import/v2/preview"),
  );
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Hafenroman.docx",
    mimeType: docxMime,
    buffer: await readFile(docxFixture),
  });
  expect((await response).ok()).toBe(true);
  await expect(dialog.getByRole("checkbox").first()).toBeVisible();
  return dialog;
}

async function openExportPreview(page: Page) {
  await page.getByRole("button", { name: "Buch exportieren", exact: true }).click();
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/manuscript-export/preview"),
  );
  await page.getByRole("menuitem", { name: "DOCX fürs Lektorat", exact: true }).click();
  expect((await response).ok()).toBe(true);
  const dialog = page.getByRole("dialog", { name: "DOCX-Inhalt prüfen", exact: true });
  await expect(dialog.getByRole("heading", { name: "Ankunft am Hafen" })).toBeVisible();
  return dialog;
}

async function openEpubPreview(page: Page) {
  await page.getByRole("button", { name: "Buch exportieren", exact: true }).click();
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/manuscript-export/preview"),
  );
  await page.getByRole("menuitem", { name: "EPUB für E-Reader", exact: true }).click();
  expect((await response).ok()).toBe(true);
  const dialog = page.getByRole("dialog", { name: "EPUB-Inhalt prüfen", exact: true });
  await expect(dialog.getByRole("heading", { name: "Ankunft am Hafen" })).toBeVisible();
  return dialog;
}

async function openHistory(page: Page) {
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Verlauf", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Verlauf", exact: true });
  await expect(dialog.locator("ins").first()).toBeVisible();
  return dialog;
}

async function openRecovery(page: Page, context: BrowserContext, worldId: string, theme: string) {
  const second = await context.newPage();
  await second.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
  await Promise.all([page.goto(`/?world=${worldId}`), second.goto(`/?world=${worldId}`)]);
  await expect(page.getByLabel("Kapiteltext")).toBeVisible();
  await expect(second.getByLabel("Kapiteltext")).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/api/manuscript?") &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
  await page.getByLabel("Kapiteltext").press("Control+End");
  await page.keyboard.type(" Sitzung A.");
  await saved;
  const conflicted = second.waitForResponse(
    (response) =>
      response.url().includes("/api/manuscript?") &&
      response.request().method() === "PUT" &&
      response.status() === 409,
  );
  await second.getByLabel("Kapiteltext").press("Control+End");
  await second.keyboard.type(" Sitzung B.");
  await conflicted;
  return second;
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: dialogs, errors, confirmation, history and recovery remain reachable`, async ({
    page,
    context,
  }, testInfo) => {
    test.skip(testInfo.project.name === "regular", "Wide and compact are the audit matrix.");
    test.setTimeout(120_000);
    await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
    const world = await seedAuditWorld(page, `Dialogprüfung ${theme} ${testInfo.project.name}`);

    await test.step("import preview and explicit 200% enlarged-text reflow", async () => {
      await page.goto("/");
      const dialog = await openImportPreview(page);
      const originalViewport = await exerciseTwoHundredPercentText(page, dialog);
      await expect(
        dialog.getByRole("button", { name: "Als neues Projekt importieren" }),
      ).toBeVisible();
      await expect(dialog.getByLabel("Projekttitel", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("checkbox").first()).toBeVisible();
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-import-200-percent`, dialog);
      await page.keyboard.press("Escape");
      await page.setViewportSize(originalViewport);
    });

    await test.step("network failure is announced without losing the dialog", async () => {
      await page.route("**/api/manuscript-import/v2/preview", (route) => route.abort("failed"), {
        times: 1,
      });
      await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
      await dialog.locator('input[type="file"]').setInputFiles({
        name: "Hafenroman.docx",
        mimeType: docxMime,
        buffer: await readFile(docxFixture),
      });
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expectContained(dialog, page);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-network-error`, dialog);
      await page.keyboard.press("Escape");
    });

    await test.step("destructive confirmation is contained and cancellable", async () => {
      await page.getByRole("button", { name: `${world.title} – Welt löschen` }).click();
      const confirmation = page.getByRole("alertdialog", {
        name: "Welt in Papierkorb verschieben",
      });
      await expectContained(confirmation, page);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-destructive`, confirmation);
      await confirmation.getByRole("button", { name: "Abbrechen" }).click();
    });

    await page.getByRole("button", { name: `${world.title} – Welt öffnen` }).click();
    await expect(page.getByLabel("Kapiteltext")).toBeVisible();

    await test.step("DOCX and EPUB export previews remain reviewable", async () => {
      const dialog = await openExportPreview(page);
      await expectContained(dialog, page);
      const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(accessibility.violations).toEqual([]);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-docx-export`, dialog);
      await page.keyboard.press("Escape");

      const epub = await openEpubPreview(page);
      await expectContained(epub, page);
      await expect(epub.getByText("Manuskript", { exact: true })).toBeVisible();
      await expect(epub.getByText("Nicht angegeben", { exact: true })).toBeVisible();
      await expect(epub.getByText("de-DE", { exact: true })).toBeVisible();
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-epub-export`, epub);
      await page.keyboard.press("Escape");
    });

    await test.step("history comparison remains readable", async () => {
      const dialog = await openHistory(page);
      await expectContained(dialog, page);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-history`, dialog);
      await page.keyboard.press("Escape");
    });

    await test.step("invalid structured import keeps existing figures", async () => {
      await page.getByRole("button", { name: "Figuren", exact: true }).click();
      await expect(page.locator(".story-node")).toHaveCount(3);
      await page.locator('input[type="file"][accept="application/json"]').setInputFiles({
        name: "invalid-figures.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ nodes: [{ id: "broken" }], edges: [] })),
      });
      const alert = page
        .getByRole("alert")
        .filter({ hasText: "Diese Datei enthält kein gültiges Figurenboard." });
      await expect(alert).toBeVisible();
      await expect(page.locator(".story-node")).toHaveCount(3);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-validation-error`);
    });

    await test.step("stale-session recovery can be deferred and resolved", async () => {
      const second = await openRecovery(page, context, world.id, theme);
      try {
        const appBar = second.locator(".app-bar");
        const saveError = appBar.getByRole("alert");
        const retry = appBar.getByRole("button", { name: "Erneut versuchen", exact: true });
        const recover = appBar.getByRole("button", { name: "Entwurf retten", exact: true });
        await expect(saveError).toBeVisible();
        await expect(retry).toBeVisible();
        await expect(recover).toBeVisible();
        if (testInfo.project.name === "compact") {
          const originalViewport = second.viewportSize();
          if (!originalViewport) throw new Error("Compact recovery requires a fixed viewport.");
          for (const width of [320, 390, 719]) {
            await second.setViewportSize({ width, height: originalViewport.height });
            await expectFrameContained(appBar, second);
            const workspaceNavigation = appBar.getByRole("navigation", {
              name: "Arbeitsbereich",
            });
            const workspaceButtons = workspaceNavigation.getByRole("button");
            await expect(workspaceButtons).toHaveCount(5);
            for (const workspaceButton of await workspaceButtons.all()) {
              await workspaceButton.scrollIntoViewIfNeeded();
              await expect(workspaceButton).toBeInViewport();
            }
            await expectFrameContained(appBar, second);
            for (const action of [retry, recover]) {
              const box = await action.boundingBox();
              const name = (await action.getAttribute("aria-label")) ?? (await action.innerText());
              expect(box?.width, `${name} width at ${width}px`).toBeGreaterThanOrEqual(44);
              expect(box?.height, `${name} height at ${width}px`).toBeGreaterThanOrEqual(44);
            }
            if (width === 320) {
              await capture(second, testInfo, `${theme}-compact-320-save-error-header`, appBar);
              await expect(
                appBar.getByRole("button", { name: "Lokalen Assistenten öffnen" }),
              ).toBeHidden();
              await expect(appBar.getByRole("button", { name: "Suche öffnen" })).toBeHidden();

              await appBar.getByRole("button", { name: "Mehr", exact: true }).click();
              await second.getByRole("menuitem", { name: "Suche", exact: true }).click();
              const search = second.getByRole("dialog", { name: "Suchen & Befehle" });
              await expect(search).toBeVisible();
              await search.getByRole("button", { name: "Dialog schließen" }).click();

              await appBar.getByRole("button", { name: "Mehr", exact: true }).click();
              await second.getByRole("menuitem", { name: "Assistent", exact: true }).click();
              const assistant = second.getByRole("dialog", { name: "Lokaler Assistent" });
              await expect(assistant).toBeVisible();
              await assistant.getByRole("button", { name: "Assistent schließen" }).click();
            }
          }
          await second.setViewportSize(originalViewport);
        }
        await retry.focus();
        await expect(retry).toBeFocused();
        await recover.focus();
        await expect(recover).toBeFocused();
        await recover.click();
        const dialog = second.getByRole("dialog", { name: "Ungespeicherten Entwurf retten" });
        await expectContained(dialog, second);
        await capture(second, testInfo, `${theme}-${testInfo.project.name}-recovery`, dialog);
        await dialog.getByRole("button", { name: "Schließen", exact: true }).click();
        await expect(second.getByLabel("Kapiteltext")).toContainText("Sitzung B.");

        await second.getByRole("button", { name: "Entwurf retten", exact: true }).click();
        const reopened = second.getByRole("dialog", { name: "Ungespeicherten Entwurf retten" });
        await reopened
          .getByRole("button", { name: "Gespeicherte Fassung laden", exact: true })
          .click();
        await expect(reopened).toContainText("Sitzung A.");
        const downloaded = second.waitForEvent("download");
        await reopened
          .getByRole("button", { name: "Beide Fassungen als JSON herunterladen", exact: true })
          .click();
        await downloaded;
        await reopened
          .getByRole("button", {
            name: "Meinen Entwurf als neue Fassung speichern",
            exact: true,
          })
          .click();
        await expect(reopened).toHaveCount(0);
        await expect
          .poll(async () => {
            const response = await second.request.get(`/api/manuscript?world=${world.id}`);
            return (await response.json()).payload.chapters[0].body;
          })
          .toContain("Sitzung B.");
        await expect(appBar).not.toHaveClass(/app-bar--save-error/);
        await expect(
          appBar.getByRole("button", { name: "Lokalen Assistenten öffnen" }),
        ).toBeVisible();
        await expect(appBar.getByRole("button", { name: "Suche öffnen" })).toBeVisible();
        await appBar.getByRole("button", { name: "Mehr", exact: true }).click();
        await expect(second.getByRole("menuitem", { name: "Assistent", exact: true })).toHaveCount(
          0,
        );
        await expect(second.getByRole("menuitem", { name: "Suche", exact: true })).toHaveCount(0);
        await second.keyboard.press("Escape");
      } finally {
        await second.close();
      }
    });
  });

  test(`${theme}: populated storyboard editing and place-map tools remain usable`, async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name === "regular", "Wide and compact are the audit matrix.");
    test.setTimeout(90_000);
    await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
    const world = await seedAuditWorld(page, `Werkzeugprüfung ${theme} ${testInfo.project.name}`);
    await page.goto(`/?world=${world.id}`);
    await expect(page.getByLabel("Kapiteltext")).toBeVisible();

    await test.step("populated storyboard can be edited", async () => {
      await page.getByRole("button", { name: "Storyboard", exact: true }).click();
      await expect(page.locator('[data-storyboard-node-kind="note"]')).toHaveCount(2);
      const note = page.locator('[data-storyboard-node-kind="note"]').first();
      const editor = note.getByRole("textbox", { name: "Storyboard-Notiz" });
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes("/api/storyboards") &&
          response.request().method() === "PUT" &&
          response.ok(),
      );
      await editor.fill("Ankunft, Prüfung und Aufbruch.");
      await saved;
      await expect(editor).toHaveText("Ankunft, Prüfung und Aufbruch.");
      await expectContained(page.locator(".storyboard-workspace"), page);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-storyboard`);
    });

    await test.step("distance mode and map creation stay reachable", async () => {
      await page.getByRole("button", { name: "Orte", exact: true }).click();
      await expect(page.locator(".places-workspace")).toBeVisible();
      await page.getByRole("button", { name: "Distanz messen", exact: true }).click();
      await expect(page.locator(".places-measure-overlays")).toBeVisible();
      const nordhafen = page.locator('.react-flow__node[data-id="nordhafen"]');
      const suedhafen = page.locator('.react-flow__node[data-id="suedhafen"]');
      await nordhafen.click();
      await expect(page.locator(".places-measure-overlays").getByRole("status")).toContainText(
        "Wähle den zweiten Ort für die gezielte Distanz.",
      );
      await suedhafen.click();
      const targeted = page.locator(".distance-edge.is-targeted");
      await expect(targeted).toHaveCount(1);
      await expect(targeted).toHaveAttribute(
        "aria-label",
        /Nordhafen.*Südhafen.*\d+.*(?:km|px|Einheiten)/,
      );
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-distance`);

      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Neue Karte", exact: true }).click();
      await (await chooser).setFiles({
        name: "audit-karte.png",
        mimeType: "image/png",
        buffer: mapPng,
      });
      await expect
        .poll(async () => {
          const response = await page.request.get(`/api/state?world=${world.id}`);
          const body = await response.json();
          return body.payload.nodes.some((node: { mapImageId?: string }) => node.mapImageId);
        })
        .toBe(true);
      await expect(
        page.getByRole("img", { name: "Neue Karte", exact: true }).first(),
      ).toBeVisible();
      await expectContained(page.locator(".places-workspace"), page);
      await capture(page, testInfo, `${theme}-${testInfo.project.name}-map-created`);
    });
  });
}

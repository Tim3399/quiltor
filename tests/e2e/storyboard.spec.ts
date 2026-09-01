import type { Locator, Page, Response } from "@playwright/test";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { encodeStoryWorldDocument } from "./support/application-api";
import { clickVisibleGraphEdge } from "./support/graph-interaction";
import { createTestWorld, expect, test } from "./support/world-fixture";

function waitForSuccessfulStoryboardWrite(page: Page, payloadMarker: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/api/storyboards") &&
      response.request().method() === "PUT" &&
      Boolean(response.request().postData()?.includes(payloadMarker)) &&
      response.ok(),
  );
}

async function openStoryboard(page: Page, worldId: string) {
  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();
}

async function openStoryboardLibrary(page: Page) {
  const library = page.locator("aside.storyboard-library");
  if (!(await library.isVisible())) {
    await page
      .getByRole("toolbar", { name: "Storyboard-Werkzeuge" })
      .getByRole("button", { name: "Elementbibliothek ein-/ausblenden" })
      .click();
  }
  await expect(library).toBeVisible();
  return library;
}

async function expectInsideViewport(locator: Locator, page: Page) {
  const [bounds, viewport] = await Promise.all([
    locator.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
  ]);
  if (!bounds) throw new Error("Expected element has no browser bounds");
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function dragBy(page: Page, target: ReturnType<Page["locator"]>, x: number, y: number) {
  const bounds = await target.boundingBox();
  if (!bounds) throw new Error("Drag target has no browser bounds");
  const start = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + x, start.y + y, { steps: 8 });
  await page.mouse.up();
}

async function dragBetween(page: Page, source: Locator, target: Locator) {
  const sourceBounds = await source.boundingBox();
  const targetBounds = await target.boundingBox();
  if (!sourceBounds || !targetBounds) throw new Error("Connection handle has no browser bounds");
  await page.mouse.move(
    sourceBounds.x + sourceBounds.width / 2,
    sourceBounds.y + sourceBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBounds.x + targetBounds.width / 2,
    targetBounds.y + targetBounds.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();
}

type StoryboardWireNode = {
  id: string;
  kind: string;
  x: number;
  y: number;
  zIndex?: number;
  target?: { kind?: string; id?: string };
};

type StoryboardWireEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
  directed?: boolean;
};

type StoryboardWireEnvelope = {
  payload: {
    nodes: StoryboardWireNode[];
    edges: StoryboardWireEdge[];
  };
};

function writtenStoryboard(response: Response) {
  return response.request().postDataJSON() as StoryboardWireEnvelope;
}

async function loadedStoryboard(page: Page, worldId: string) {
  const response = await page.request.get(`/api/storyboards?world=${worldId}`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as StoryboardWireEnvelope;
}

async function storyboardViewportZoom(page: Page) {
  return page.locator(".storyboard-flow .react-flow__viewport").evaluate((viewport) => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(viewport).transform);
    return Math.hypot(transform.a, transform.b);
  });
}

test("Storyboard-Boards und Notizen bleiben nach einem Reload erhalten", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Persistenzpfad ist viewport-unabhängig und muss nur einmal laufen.",
  );

  const world = await createTestWorld(page, `Storyboard E2E ${crypto.randomUUID()}`);
  const boardTitle = `Akt Zwei ${crypto.randomUUID()}`;
  const noteText = `Mara findet den Nordhafen ${crypto.randomUUID()}`;

  await openStoryboard(page, world.id);

  const toolbar = page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
  await toolbar.getByRole("button", { name: "Storyboard hinzufügen", exact: true }).click();

  await toolbar.getByRole("button", { name: "Storyboard umbenennen", exact: true }).click();
  const boardName = toolbar.getByRole("textbox", { name: "Storyboard-Name" });
  await expect(boardName).toHaveValue("Neues Storyboard 2");
  await boardName.fill(boardTitle);
  await boardName.press("Enter");

  const saved = waitForSuccessfulStoryboardWrite(page, noteText);
  await toolbar.getByRole("button", { name: "Notiz hinzufügen", exact: true }).click();

  const note = page.locator('[data-storyboard-node-kind="note"]');
  await expect(note).toHaveCount(1);
  const noteEditor = note.getByRole("textbox", { name: "Storyboard-Notiz" });
  await noteEditor.fill(noteText);

  const saveResponse = await saved;
  expect(saveResponse.status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  const boardSelect = page.getByRole("combobox", { name: "Storyboard auswählen" });
  await boardSelect.click();
  await page.getByRole("option", { name: boardTitle, exact: true }).click();

  await expect(boardSelect).toContainText(boardTitle);
  const persistedNote = page.locator('[data-storyboard-node-kind="note"]');
  await expect(persistedNote).toHaveCount(1);
  await expect(persistedNote.getByRole("textbox", { name: "Storyboard-Notiz" })).toHaveText(
    noteText,
  );
});

test("unkritische Storyboard-Karten lassen sich per Tastatur löschen und wiederherstellen", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Tastaturlöschung, Undo und Persistenz sind viewport-unabhängig und müssen nur einmal laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Delete Keys ${crypto.randomUUID()}`);
  const editorText = `Schutztext ${crypto.randomUUID()}`;
  await openStoryboard(page, world.id);

  const toolbar = page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
  const noteCreatedWithDelete = waitForSuccessfulStoryboardWrite(page, '"kind":"note"');
  await toolbar.getByRole("button", { name: "Notiz hinzufügen", exact: true }).click();
  const deleteCreation = writtenStoryboard(await noteCreatedWithDelete).payload.nodes.filter(
    (node) => node.kind === "note",
  );
  expect(deleteCreation).toHaveLength(1);
  const deleteNoteId = deleteCreation[0].id;
  const deleteNote = page.locator(`.react-flow__node[data-id="${deleteNoteId}"]`);
  await expect(deleteNote).toBeVisible();

  // Toolbar additions share the canvas center. Move the first card so both remain user-clickable.
  const firstNoteMoved = waitForSuccessfulStoryboardWrite(page, `"id":"${deleteNoteId}"`);
  await dragBy(page, deleteNote.locator(".storyboard-node__header"), -320, -120);
  await firstNoteMoved;

  const noteCreatedWithBackspace = waitForSuccessfulStoryboardWrite(page, '"kind":"note"');
  await toolbar.getByRole("button", { name: "Notiz hinzufügen", exact: true }).click();
  const backspaceCreation = writtenStoryboard(await noteCreatedWithBackspace).payload.nodes.filter(
    (node) => node.kind === "note",
  );
  expect(backspaceCreation).toHaveLength(2);
  const backspaceNoteId = backspaceCreation.find((node) => node.id !== deleteNoteId)?.id;
  expect(backspaceNoteId).toBeTruthy();
  if (!backspaceNoteId) throw new Error("Second Storyboard note was not created");

  const backspaceNote = page.locator(`.react-flow__node[data-id="${backspaceNoteId}"]`);
  await expect(backspaceNote).toBeVisible();

  // Editing surfaces own Backspace/Delete. Neither key may bubble into card deletion.
  const editor = deleteNote.getByRole("textbox", { name: "Storyboard-Notiz" });
  const editorSaved = waitForSuccessfulStoryboardWrite(page, editorText);
  await editor.fill(editorText);
  await editorSaved;

  const shortenedEditorText = editorText.slice(0, -1);
  const editorBackspaceSaved = waitForSuccessfulStoryboardWrite(page, shortenedEditorText);
  await editor.press("End");
  await editor.press("Backspace");
  await editorBackspaceSaved;
  await expect(editor).toHaveText(shortenedEditorText);
  await expect(page.locator('[data-storyboard-node-kind="note"]')).toHaveCount(2);

  const search = page.getByRole("searchbox", { name: "Welt durchsuchen" });
  await search.fill("Suche");
  await search.press("Home");
  await search.press("Delete");
  await expect(search).toHaveValue("uche");
  await expect(page.locator('[data-storyboard-node-kind="note"]')).toHaveCount(2);

  await deleteNote.locator(".storyboard-node__header").click();
  await expect(deleteNote.locator(".storyboard-node")).toHaveClass(/is-selected/);
  const deletedWithDelete = waitForSuccessfulStoryboardWrite(page, `"id":"${backspaceNoteId}"`);
  await page.keyboard.press("Delete");
  const deleteResponse = writtenStoryboard(await deletedWithDelete);
  expect(deleteResponse.payload.nodes.some((node) => node.id === deleteNoteId)).toBe(false);
  expect(deleteResponse.payload.nodes.some((node) => node.id === backspaceNoteId)).toBe(true);
  await expect(deleteNote).toHaveCount(0);

  const undoSaved = waitForSuccessfulStoryboardWrite(page, `"id":"${deleteNoteId}"`);
  await toolbar.getByRole("button", { name: "Rückgängig", exact: true }).click();
  const undoResponse = writtenStoryboard(await undoSaved);
  expect(undoResponse.payload.nodes.some((node) => node.id === deleteNoteId)).toBe(true);
  await expect(deleteNote).toBeVisible();

  await backspaceNote.locator(".storyboard-node__header").click();
  await expect(backspaceNote.locator(".storyboard-node")).toHaveClass(/is-selected/);
  const deletedWithBackspace = waitForSuccessfulStoryboardWrite(page, `"id":"${deleteNoteId}"`);
  await page.keyboard.press("Backspace");
  const backspaceResponse = writtenStoryboard(await deletedWithBackspace);
  expect(backspaceResponse.payload.nodes.some((node) => node.id === deleteNoteId)).toBe(true);
  expect(backspaceResponse.payload.nodes.some((node) => node.id === backspaceNoteId)).toBe(false);
  await expect(backspaceNote).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  let persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.filter((node) => node.kind === "note")).toEqual([
    expect.objectContaining({ id: deleteNoteId }),
  ]);

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();
  await expect(
    page.locator(`.react-flow__node[data-id="${deleteNoteId}"] [data-storyboard-node-kind="note"]`),
  ).toHaveCount(1);
  await expect(page.locator(`.react-flow__node[data-id="${backspaceNoteId}"]`)).toHaveCount(0);
  persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.filter((node) => node.kind === "note")).toEqual([
    expect.objectContaining({ id: deleteNoteId }),
  ]);
});

test("eine Weltreferenz lässt sich auf den leeren Storyboard-Mittelpunkt ziehen", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der native Drag-and-drop-Pfad muss nur einmal in einem stabilen Desktop-Viewport laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Drag E2E ${crypto.randomUUID()}`);
  const referenceNote = `Wendepunkt am Hafen ${crypto.randomUUID()}`;

  await openStoryboard(page, world.id);

  const emptyState = page.getByLabel("Platz für deine Ideen", { exact: true });
  const chapterSource = page.getByRole("button", {
    name: "Ohne Titel auf dem Storyboard platzieren",
    exact: true,
  });
  await expect(emptyState).toBeVisible();
  await expect(chapterSource).toBeVisible();

  const dropped = waitForSuccessfulStoryboardWrite(page, '"kind":"chapter"');
  await chapterSource.dragTo(emptyState);

  const dropResponse = await dropped;
  expect(dropResponse.status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  const referenceCard = page.locator('[data-storyboard-node-kind="reference"]');
  await expect(referenceCard).toHaveCount(1);
  await expect(referenceCard).toContainText("Ohne Titel");

  const noteSaved = waitForSuccessfulStoryboardWrite(page, referenceNote);
  await referenceCard.getByRole("textbox", { name: "Notiz zu Ohne Titel" }).fill(referenceNote);
  const noteResponse = await noteSaved;
  expect(noteResponse.status()).toBe(200);
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  const persistedReference = page.locator('[data-storyboard-node-kind="reference"]');
  await expect(persistedReference).toHaveCount(1);
  await expect(persistedReference).toContainText("Ohne Titel");
  await expect(persistedReference.getByRole("textbox", { name: "Notiz zu Ohne Titel" })).toHaveText(
    referenceNote,
  );
});

test("eine leere Notiz lässt sich aus der Bibliothek frei auf dem Storyboard platzieren", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der native Palette-Drag muss nur einmal in einem stabilen Desktop-Viewport laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Note Drag E2E ${crypto.randomUUID()}`);
  await openStoryboard(page, world.id);

  const noteSource = page.getByRole("button", {
    name: "Leere Notiz auf dem Storyboard platzieren",
    exact: true,
  });
  const pane = page.locator(".storyboard-flow .react-flow__pane");
  const viewport = page.locator(".storyboard-flow .react-flow__viewport");
  await expect(noteSource).toBeVisible();
  await expect(noteSource).toHaveAttribute("draggable", "true");
  await expect(pane).toBeVisible();
  await expect(page.locator('[data-storyboard-node-kind="note"]')).toHaveCount(0);

  await expect
    .poll(async () =>
      viewport.evaluate((element) => {
        const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return {
          x: Number(transform.e.toFixed(3)),
          y: Number(transform.f.toFixed(3)),
          zoom: Number(Math.hypot(transform.a, transform.b).toFixed(3)),
        };
      }),
    )
    .toEqual({ x: 0, y: 0, zoom: 1 });

  const paneBounds = await pane.boundingBox();
  if (!paneBounds) throw new Error("Storyboard pane has no browser bounds");
  const targetPosition = {
    x: Math.round(paneBounds.width * 0.68),
    y: Math.round(paneBounds.height * 0.26),
  };
  const freePaneHit = await page.evaluate(
    ({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      return Boolean(
        target?.closest(".react-flow__pane") &&
          !target.closest(
            ".storyboard-empty-state, .storyboard-breadcrumb-panel, .react-flow__controls, .react-flow__minimap",
          ),
      );
    },
    {
      x: paneBounds.x + targetPosition.x,
      y: paneBounds.y + targetPosition.y,
    },
  );
  expect(freePaneHit).toBe(true);

  const saved = waitForSuccessfulStoryboardWrite(page, '"kind":"note"');
  await noteSource.dragTo(pane, { targetPosition });
  const saveResponse = await saved;
  expect(saveResponse.status()).toBe(200);

  const createdNotes = writtenStoryboard(saveResponse).payload.nodes.filter(
    (node) => node.kind === "note",
  );
  expect(createdNotes).toHaveLength(1);
  const createdNote = createdNotes[0];
  expect(createdNote.x).toBeGreaterThan(targetPosition.x - 30);
  expect(createdNote.x).toBeLessThan(targetPosition.x + 30);
  expect(createdNote.y).toBeGreaterThan(targetPosition.y - 30);
  expect(createdNote.y).toBeLessThan(targetPosition.y + 30);

  const selectedNote = page.locator(
    `.react-flow__node[data-id="${createdNote.id}"] .storyboard-node`,
  );
  await expect(selectedNote).toHaveClass(/is-selected/);
  await expect(page.locator('[data-storyboard-node-kind="note"]')).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  let persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.filter((node) => node.kind === "note")).toEqual([
    expect.objectContaining({
      id: createdNote.id,
      x: createdNote.x,
      y: createdNote.y,
    }),
  ]);

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  await expect(
    page.locator(
      `.react-flow__node[data-id="${createdNote.id}"] [data-storyboard-node-kind="note"]`,
    ),
  ).toHaveCount(1);
  persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.find((node) => node.id === createdNote.id)).toMatchObject({
    kind: "note",
    x: createdNote.x,
    y: createdNote.y,
  });
});

test("die kompakte Elementbibliothek platziert eine Notiz per Tastatur", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "compact",
    "Der Tastatur-Fallback wird gezielt im kompakten 390-Pixel-Viewport geprüft.",
  );

  const world = await createTestWorld(page, `Storyboard Note Keyboard ${crypto.randomUUID()}`);
  await openStoryboard(page, world.id);
  const library = await openStoryboardLibrary(page);
  const noteSource = library.getByRole("button", {
    name: "Leere Notiz auf dem Storyboard platzieren",
    exact: true,
  });
  await expect(noteSource).toBeVisible();
  const canvasBounds = await page.locator(".storyboard-canvas-shell").boundingBox();
  if (!canvasBounds) throw new Error("Storyboard canvas has no browser bounds");
  await expect
    .poll(async () =>
      page.locator(".storyboard-flow .react-flow__viewport").evaluate((element) => {
        const transform = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return {
          x: Number(transform.e.toFixed(3)),
          y: Number(transform.f.toFixed(3)),
          zoom: Number(Math.hypot(transform.a, transform.b).toFixed(3)),
        };
      }),
    )
    .toEqual({ x: 0, y: 0, zoom: 1 });

  const saved = waitForSuccessfulStoryboardWrite(page, '"kind":"note"');
  await noteSource.focus();
  await expect(noteSource).toBeFocused();
  await noteSource.press("Enter");
  const saveResponse = await saved;
  expect(saveResponse.status()).toBe(200);

  const createdNotes = writtenStoryboard(saveResponse).payload.nodes.filter(
    (node) => node.kind === "note",
  );
  expect(createdNotes).toHaveLength(1);
  const createdNote = createdNotes[0];
  expect(Number.isFinite(createdNote.x)).toBe(true);
  expect(Number.isFinite(createdNote.y)).toBe(true);
  expect(createdNote.x).toBeGreaterThanOrEqual(0);
  expect(createdNote.y).toBeGreaterThanOrEqual(0);
  expect(createdNote.x).toBeGreaterThan(canvasBounds.width / 2 - 140 - 30);
  expect(createdNote.x).toBeLessThan(canvasBounds.width / 2 - 140 + 30);
  expect(createdNote.y).toBeGreaterThan(canvasBounds.height / 2 - 105 - 30);
  expect(createdNote.y).toBeLessThan(canvasBounds.height / 2 - 105 + 30);
  await expect(library).toHaveCount(0);
  await expect(
    page.locator(`.react-flow__node[data-id="${createdNote.id}"] .storyboard-node`),
  ).toHaveClass(/is-selected/);

  const persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.filter((node) => node.kind === "note")).toEqual([
    expect.objectContaining({
      id: createdNote.id,
      x: createdNote.x,
      y: createdNote.y,
    }),
  ]);
});

test("die Elementbibliothek bleibt im kompakten Landscape-Viewport vollständig bedienbar", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Die Landscape-Abnahme setzt ihren 740-mal-390-Pixel-Viewport selbst.",
  );
  await page.setViewportSize({ width: 740, height: 390 });

  const world = await createTestWorld(page, `Storyboard Library Landscape ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const storyWorldResponse = await page.request.get(`/api/state?world=${worldId}`);
  const storyWorldRevision = Number(
    (storyWorldResponse.headers().etag || '"0"').replaceAll('"', ""),
  );
  const storyWorldSaved = await page.request.put(`/api/state?world=${worldId}`, {
    headers: { "If-Match": `"${storyWorldRevision}"` },
    data: encodeStoryWorldDocument(
      {
        nodes: Array.from({ length: 12 }, (_, index) => ({
          id: `landscape-figure-${index}`,
          name: `Landscape-Figur ${index + 1}`,
          type: "person" as const,
          x: 80 + index * 20,
          y: 100 + index * 20,
        })),
        edges: [],
      },
      storyWorldRevision,
    ),
  });
  expect(storyWorldSaved.ok()).toBe(true);

  await openStoryboard(page, world.id);
  const library = await openStoryboardLibrary(page);
  const noteSource = library.getByRole("button", {
    name: "Leere Notiz auf dem Storyboard platzieren",
    exact: true,
  });
  const search = library.getByRole("searchbox", { name: "Welt durchsuchen" });
  const results = library.locator(".storyboard-search-results");
  await expect(noteSource).toBeVisible();
  await expect(search).toBeVisible();
  await expect(results).toBeVisible();
  await expectInsideViewport(library, page);
  await expectInsideViewport(noteSource, page);
  await expectInsideViewport(search, page);
  await expectInsideViewport(results, page);

  const panelMetrics = await library.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(panelMetrics.scrollWidth).toBeLessThanOrEqual(panelMetrics.clientWidth + 1);
  expect(panelMetrics.scrollHeight).toBeLessThanOrEqual(panelMetrics.clientHeight + 1);

  const resultMetrics = await results.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(["auto", "scroll"]).toContain(resultMetrics.overflowY);
  expect(resultMetrics.scrollHeight).toBeGreaterThan(resultMetrics.clientHeight);
  await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("die fokussierte Weltsuche bleibt bei eingeblendeter Bildschirmtastatur bedienbar", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "compact",
    "Der Bildschirmtastatur-Fall wird gezielt im 390-mal-390-Pixel-Viewport geprüft.",
  );
  await page.setViewportSize({ width: 390, height: 390 });

  const world = await createTestWorld(page, `Storyboard Search Keyboard ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const storyWorldResponse = await page.request.get(`/api/state?world=${worldId}`);
  const storyWorldRevision = Number(
    (storyWorldResponse.headers().etag || '"0"').replaceAll('"', ""),
  );
  const storyWorldSaved = await page.request.put(`/api/state?world=${worldId}`, {
    headers: { "If-Match": `"${storyWorldRevision}"` },
    data: encodeStoryWorldDocument(
      {
        nodes: Array.from({ length: 12 }, (_, index) => ({
          id: `keyboard-figure-${index}`,
          name: `Tastatur-Figur ${index + 1}`,
          type: "person" as const,
          x: 80 + index * 20,
          y: 100 + index * 20,
        })),
        edges: [],
      },
      storyWorldRevision,
    ),
  });
  expect(storyWorldSaved.ok()).toBe(true);

  await openStoryboard(page, world.id);
  const library = await openStoryboardLibrary(page);
  const noteSource = library.getByRole("button", {
    name: "Leere Notiz auf dem Storyboard platzieren",
    exact: true,
  });
  const search = library.getByRole("searchbox", { name: "Welt durchsuchen" });
  const results = library.locator(".storyboard-search-results");
  await search.focus();
  await expect(search).toBeFocused();
  await expect(noteSource).toBeHidden();
  await expect(results).toBeVisible();
  await expectInsideViewport(search, page);
  await expectInsideViewport(results, page);

  const resultMetrics = await results.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(["auto", "scroll"]).toContain(resultMetrics.overflowY);
  expect(resultMetrics.clientHeight).toBeGreaterThanOrEqual(44);
  expect(resultMetrics.scrollHeight).toBeGreaterThan(resultMetrics.clientHeight);
  await results.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => results.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await results.evaluate((element) => {
    element.scrollTop = 0;
  });

  const firstResult = library.getByRole("button", {
    name: "Tastatur-Figur 1 auf dem Storyboard platzieren",
    exact: true,
  });
  await firstResult.scrollIntoViewIfNeeded();
  await expect(firstResult).toBeVisible();
  await expectInsideViewport(firstResult, page);
  const visibleResultIntersection = await firstResult.evaluate((element) => {
    const result = element.getBoundingClientRect();
    const scrollContainer = element.closest(".storyboard-search-results")?.getBoundingClientRect();
    if (!scrollContainer) return null;
    return {
      width: Math.max(
        0,
        Math.min(result.right, scrollContainer.right) - Math.max(result.left, scrollContainer.left),
      ),
      height: Math.max(
        0,
        Math.min(result.bottom, scrollContainer.bottom) - Math.max(result.top, scrollContainer.top),
      ),
      resultWidth: result.width,
    };
  });
  expect(visibleResultIntersection).not.toBeNull();
  expect(visibleResultIntersection?.width).toBeGreaterThanOrEqual(
    (visibleResultIntersection?.resultWidth ?? 0) - 1,
  );
  expect(visibleResultIntersection?.height).toBeGreaterThanOrEqual(44);
  const placed = waitForSuccessfulStoryboardWrite(page, '"id":"keyboard-figure-0"');
  await firstResult.click();
  expect((await placed).ok()).toBe(true);
  await expect(page.locator('[data-storyboard-node-kind="reference"]')).toHaveCount(1);
  await expect(page.locator('[data-storyboard-node-kind="reference"]')).toContainText(
    "Tastatur-Figur 1",
  );
});

test("ein Figuren-Backlink öffnet die exakte Storyboard-Karte", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Die Zielnavigation ist viewport-unabhängig und muss nur einmal laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Backlink E2E ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const storyWorldResponse = await page.request.get(`/api/state?world=${worldId}`);
  const storyWorldRevision = Number(
    (storyWorldResponse.headers().etag || '"0"').replaceAll('"', ""),
  );
  const storyWorldSaved = await page.request.put(`/api/state?world=${worldId}`, {
    headers: { "If-Match": `"${storyWorldRevision}"` },
    data: encodeStoryWorldDocument(
      {
        nodes: [{ id: "ada", name: "Ada", type: "person", x: 160, y: 180 }],
        edges: [],
      },
      storyWorldRevision,
    ),
  });
  expect(storyWorldSaved.ok()).toBe(true);

  const storyboardResponse = await page.request.get(`/api/storyboards?world=${worldId}`);
  const storyboardRevision = Number(
    (storyboardResponse.headers().etag || '"0"').replaceAll('"', ""),
  );
  const storyboardSaved = await page.request.put(`/api/storyboards?world=${worldId}`, {
    headers: { "If-Match": `"${storyboardRevision}"` },
    data: encodeStoryboardsV1(
      {
        boards: [
          { id: "main-storyboard", title: "Main Storyboard" },
          { id: "second-board", title: "Zweiter Akt" },
        ],
        nodes: [
          {
            id: "reference-ada",
            boardId: "second-board",
            kind: "reference",
            target: { kind: "entity", id: "ada" },
            label: "Ada im Garten",
            x: 420,
            y: 240,
          },
        ],
        edges: [],
      },
      storyboardRevision,
    ),
  });
  expect(storyboardSaved.ok()).toBe(true);

  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.locator(".story-node").filter({ hasText: "Ada" }).click();

  const inspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await inspector.getByRole("tab", { name: "Steckbrief" }).click();
  const backlink = inspector.getByRole("button", {
    name: "Storyboard – Ada im Garten – Zweiter Akt",
    exact: true,
  });
  await expect(backlink).toBeVisible();
  await backlink.click();

  await expect(page.getByRole("button", { name: "Storyboard", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("combobox", { name: "Storyboard auswählen" })).toContainText(
    "Zweiter Akt",
  );
  const selectedCard = page.locator('[data-storyboard-node-kind="reference"].is-selected');
  await expect(selectedCard).toHaveCount(1);
  await expect(selectedCard).toContainText("Ada im Garten");
});

test("Storyboard-Karten lassen sich direkt aus dem Notizinhalt ziehen", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Pointer-Drag-Pfad muss nur einmal in einem stabilen Desktop-Viewport laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Card Drag E2E ${crypto.randomUUID()}`);
  await openStoryboard(page, world.id);

  const placed = waitForSuccessfulStoryboardWrite(page, '"kind":"chapter"');
  await page
    .getByRole("button", {
      name: "Ohne Titel auf dem Storyboard platzieren",
      exact: true,
    })
    .click();
  const placeResponse = await placed;
  const placedNode = writtenStoryboard(placeResponse).payload.nodes.find(
    (node) => node.kind === "reference" && node.target?.kind === "chapter",
  );
  if (!placedNode) throw new Error("Placed chapter reference missing from write payload");

  const referenceCard = page.locator('[data-storyboard-node-kind="reference"]');
  await expect(referenceCard).toHaveCount(1);
  const cardBeforeDrag = await referenceCard.boundingBox();
  if (!cardBeforeDrag) throw new Error("Reference card has no browser bounds");

  const noteContent = referenceCard.locator(".cm-content");
  await expect(noteContent).toBeVisible();
  const noteBounds = await noteContent.boundingBox();
  if (!noteBounds) throw new Error("Reference note content has no browser bounds");
  expect(
    await page.evaluate(
      ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".cm-content")),
      {
        x: noteBounds.x + noteBounds.width / 2,
        y: noteBounds.y + noteBounds.height / 2,
      },
    ),
  ).toBe(true);

  const moved = waitForSuccessfulStoryboardWrite(page, `"id":"${placedNode.id}"`);
  await dragBy(page, noteContent, 120, 80);
  const moveResponse = await moved;
  const movedNode = writtenStoryboard(moveResponse).payload.nodes.find(
    (node) => node.id === placedNode.id,
  );
  if (!movedNode) throw new Error("Moved chapter reference missing from write payload");
  expect(movedNode.x).not.toBe(placedNode.x);
  expect(movedNode.y).not.toBe(placedNode.y);

  await expect
    .poll(async () => (await referenceCard.boundingBox())?.x ?? cardBeforeDrag.x)
    .toBeGreaterThan(cardBeforeDrag.x + 40);
  await expect
    .poll(async () => (await referenceCard.boundingBox())?.y ?? cardBeforeDrag.y)
    .toBeGreaterThan(cardBeforeDrag.y + 20);

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();
  await expect(page.locator('[data-storyboard-node-kind="reference"]')).toHaveCount(1);

  const persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.find((node) => node.id === placedNode.id)).toMatchObject({
    x: movedNode.x,
    y: movedNode.y,
  });
});

test("das Mausrad zoomt auch über dem Inhalt einer Storyboard-Karte", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der Mausradpfad muss nur einmal in einem stabilen Desktop-Viewport laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Wheel Zoom E2E ${crypto.randomUUID()}`);
  await openStoryboard(page, world.id);

  const saved = waitForSuccessfulStoryboardWrite(page, '"kind":"note"');
  await page
    .getByRole("toolbar", { name: "Storyboard-Werkzeuge" })
    .getByRole("button", { name: "Notiz hinzufügen", exact: true })
    .click();
  expect((await saved).ok()).toBe(true);

  const cardBody = page.locator('[data-storyboard-node-kind="note"] .storyboard-node__body');
  await expect(cardBody).toBeVisible();

  const initialZoom = await storyboardViewportZoom(page);
  await page.locator(".storyboard-flow .react-flow__controls-zoomout").click();
  await expect.poll(() => storyboardViewportZoom(page)).toBeLessThan(initialZoom - 0.01);

  const zoomBefore = await storyboardViewportZoom(page);
  await cardBody.hover();
  await page.mouse.wheel(0, -480);

  await expect
    .poll(() => storyboardViewportZoom(page), {
      message: "Mausrad-Zoom soll den ReactFlow-Viewport auch über dem Karteninhalt erreichen.",
    })
    .toBeGreaterThan(zoomBefore + 0.01);
});

test("überlappende Storyboard-Karten behalten ihre Vorder- und Hintergrundreihenfolge", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Die Ebenenreihenfolge ist viewport-unabhängig und muss nur einmal laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Layers E2E ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const storyboardResponse = await page.request.get(`/api/storyboards?world=${worldId}`);
  const storyboardRevision = Number(
    (storyboardResponse.headers().etag || '"0"').replaceAll('"', ""),
  );
  const storyboardSaved = await page.request.put(`/api/storyboards?world=${worldId}`, {
    headers: { "If-Match": `"${storyboardRevision}"` },
    data: encodeStoryboardsV1(
      {
        boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
        nodes: [
          {
            id: "layer-back",
            boardId: "main-storyboard",
            kind: "note",
            x: 180,
            y: 160,
            width: 280,
            height: 210,
            zIndex: 1,
            text: "Hintere Karte",
          },
          {
            id: "layer-front",
            boardId: "main-storyboard",
            kind: "note",
            x: 260,
            y: 220,
            width: 280,
            height: 210,
            zIndex: 2,
            text: "Vordere Karte",
          },
        ],
        edges: [],
      },
      storyboardRevision,
    ),
  });
  expect(storyboardSaved.ok()).toBe(true);

  await openStoryboard(page, world.id);

  const backCard = page.locator('.react-flow__node[data-id="layer-back"]');
  const frontCard = page.locator('.react-flow__node[data-id="layer-front"]');
  await expect(backCard).toBeVisible();
  await expect(frontCard).toBeVisible();

  const renderedZIndex = (card: Locator) =>
    card.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10));
  const renderedLayerDelta = async (back: Locator, front: Locator) => {
    const [backZIndex, frontZIndex] = await Promise.all([
      renderedZIndex(back),
      renderedZIndex(front),
    ]);
    return backZIndex - frontZIndex;
  };
  await expect.poll(() => renderedLayerDelta(backCard, frontCard)).toBeLessThan(0);

  // Both cards overlap, but this corner of the rear card remains exposed and clickable.
  await backCard.click({ position: { x: 24, y: 24 } });
  await expect(backCard.locator(".storyboard-node")).toHaveClass(/is-selected/);

  const toolbar = page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
  const moveForward = toolbar.getByRole("button", { name: "Element nach vorne" });
  const moveBackward = toolbar.getByRole("button", { name: "Element nach hinten" });
  await expect(moveForward).toBeEnabled();

  const movedForward = waitForSuccessfulStoryboardWrite(page, '"id":"layer-back"');
  await moveForward.click();
  expect((await movedForward).ok()).toBe(true);
  await expect.poll(() => renderedLayerDelta(backCard, frontCard)).toBeGreaterThan(0);

  let persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.find(({ id }) => id === "layer-back")?.zIndex).toBe(1);
  expect(persisted.payload.nodes.find(({ id }) => id === "layer-front")?.zIndex).toBe(0);

  const movedBackward = waitForSuccessfulStoryboardWrite(page, '"id":"layer-back"');
  await moveBackward.click();
  expect((await movedBackward).ok()).toBe(true);
  await expect.poll(() => renderedLayerDelta(backCard, frontCard)).toBeLessThan(0);

  persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.find(({ id }) => id === "layer-back")?.zIndex).toBe(0);
  expect(persisted.payload.nodes.find(({ id }) => id === "layer-front")?.zIndex).toBe(1);

  const movedForwardForReload = waitForSuccessfulStoryboardWrite(page, '"id":"layer-back"');
  await moveForward.click();
  expect((await movedForwardForReload).ok()).toBe(true);
  await expect.poll(() => renderedLayerDelta(backCard, frontCard)).toBeGreaterThan(0);

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  const reloadedBackCard = page.locator('.react-flow__node[data-id="layer-back"]');
  const reloadedFrontCard = page.locator('.react-flow__node[data-id="layer-front"]');
  await expect(reloadedBackCard).toBeVisible();
  await expect(reloadedFrontCard).toBeVisible();
  await expect
    .poll(() => renderedLayerDelta(reloadedBackCard, reloadedFrontCard))
    .toBeGreaterThan(0);

  persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.nodes.find(({ id }) => id === "layer-back")?.zIndex).toBe(1);
  expect(persisted.payload.nodes.find(({ id }) => id === "layer-front")?.zIndex).toBe(0);
});

test("die Ebenensteuerung bleibt im kompakten Storyboard erreichbar", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "compact",
    "Dieser Vertrag prüft gezielt den kompakten 390-Pixel-Viewport.",
  );

  const world = await createTestWorld(page, `Storyboard Layers Compact ${crypto.randomUUID()}`);
  await openStoryboard(page, world.id);

  const toolbar = page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" });
  const addNote = toolbar.getByRole("button", { name: "Notiz hinzufügen", exact: true });
  for (let index = 0; index < 2; index += 1) {
    const saved = waitForSuccessfulStoryboardWrite(page, '"kind":"note"');
    await addNote.click();
    expect((await saved).ok()).toBe(true);
  }

  const moveForward = toolbar.getByRole("button", { name: "Element nach vorne" });
  const moveBackward = toolbar.getByRole("button", { name: "Element nach hinten" });
  await expect(moveForward).toBeVisible();
  await expect(moveForward).toBeDisabled();
  await expect(moveBackward).toBeVisible();
  await expect(moveBackward).toBeEnabled();
  const dimensions = await toolbar.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});

test("Storyboard-Kanten lassen sich beschriften, richten, umkehren und neu laden", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Der native Kantenpfad muss nur einmal in einem stabilen Desktop-Viewport laufen.",
  );

  const world = await createTestWorld(page, `Storyboard Edge E2E ${crypto.randomUUID()}`);
  const edgeLabel = `führt zu ${crypto.randomUUID()}`;
  await openStoryboard(page, world.id);

  const chapterPlaced = waitForSuccessfulStoryboardWrite(page, '"kind":"chapter"');
  await page
    .getByRole("button", {
      name: "Ohne Titel auf dem Storyboard platzieren",
      exact: true,
    })
    .click();
  await chapterPlaced;
  const referenceCard = page.locator('[data-storyboard-node-kind="reference"]');
  await expect(referenceCard).toHaveCount(1);
  const referenceMoved = waitForSuccessfulStoryboardWrite(page, '"kind":"chapter"');
  await dragBy(page, referenceCard.locator(".storyboard-node__title"), -220, -80);
  await referenceMoved;

  const boardPlaced = waitForSuccessfulStoryboardWrite(page, '"kind":"storyboard"');
  await page
    .getByRole("button", {
      name: "Main Storyboard auf dem Storyboard platzieren",
      exact: true,
    })
    .click();
  await boardPlaced;
  const boardCard = page.locator('[data-storyboard-node-kind="storyboard"]');
  await expect(boardCard).toHaveCount(1);
  const boardMoved = waitForSuccessfulStoryboardWrite(page, '"kind":"storyboard"');
  await dragBy(page, boardCard.locator(".storyboard-node__title"), 220, 80);
  await boardMoved;

  const connected = waitForSuccessfulStoryboardWrite(page, '"edges":[{');
  await dragBetween(
    page,
    referenceCard.locator('.neutral-handle[data-handleid="neutral-bottom"]'),
    boardCard.locator('.neutral-handle[data-handleid="neutral-top"]'),
  );
  const connectedResponse = await connected;
  const connectedEdge = writtenStoryboard(connectedResponse).payload.edges[0];
  expect(connectedEdge).toMatchObject({ directed: false });

  const edge = page.locator(`.react-flow__edge[data-id="${connectedEdge.id}"]`);
  await clickVisibleGraphEdge(page, edge);
  const edgePath = edge.locator(".react-flow__edge-path");
  const inspector = page.getByRole("region", { name: "Verbindung" });
  await expect(inspector).toContainText("Ohne Titel ↔ Main Storyboard");

  const labelSaved = waitForSuccessfulStoryboardWrite(page, edgeLabel);
  await inspector.getByRole("textbox", { name: "Beschriftung" }).fill(edgeLabel);
  await labelSaved;

  const lineStyleSaved = waitForSuccessfulStoryboardWrite(page, '"lineStyle":"dotted"');
  await inspector.getByRole("combobox", { name: "Linienart" }).click();
  await page.getByRole("option", { name: "Gepunktet" }).click();
  await lineStyleSaved;

  const directedSaved = waitForSuccessfulStoryboardWrite(page, '"directed":true');
  await inspector.getByRole("checkbox", { name: "Gerichtet" }).check();
  const directedResponse = await directedSaved;
  const directedEdge = writtenStoryboard(directedResponse).payload.edges[0];
  expect(directedEdge).toMatchObject({ label: edgeLabel, directed: true, lineStyle: "dotted" });
  await expect(inspector).toContainText("Ohne Titel → Main Storyboard");

  const reversedSaved = waitForSuccessfulStoryboardWrite(page, edgeLabel);
  await inspector.getByRole("button", { name: "Richtung umkehren" }).click();
  const reversedResponse = await reversedSaved;
  const reversedEdge = writtenStoryboard(reversedResponse).payload.edges[0];
  expect(reversedEdge).toMatchObject({
    sourceNodeId: directedEdge.targetNodeId,
    targetNodeId: directedEdge.sourceNodeId,
    label: edgeLabel,
    directed: true,
  });
  await expect(inspector).toContainText("Main Storyboard → Ohne Titel");
  await expect(page.locator(".graph-edge-label")).toContainText(edgeLabel);
  await expect(edgePath).toHaveAttribute("marker-end", /url\(['"]?#/);
  await expect(page.locator(".react-flow__edge")).toHaveClass(/edge-line-dotted/);
  await expect(page.getByRole("status")).toContainText("Gespeichert");

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  await expect(page.locator(".graph-edge-label")).toContainText(edgeLabel);
  await expect(page.locator(".react-flow__edge-path")).toHaveAttribute("marker-end", /url\(['"]?#/);
  const persisted = await loadedStoryboard(page, world.id);
  expect(persisted.payload.edges[0]).toMatchObject(reversedEdge);
});

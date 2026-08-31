import type { Locator, Page, Response } from "@playwright/test";
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

  const edgePath = page.locator(".react-flow__edge-path");
  await expect(edgePath).toHaveCount(1);
  await edgePath.click({ force: true });
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

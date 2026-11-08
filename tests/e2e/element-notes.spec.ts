import type { Locator, Page } from "@playwright/test";
import { seedExampleWorld, type SeededExampleWorld } from "./support/example-world";
import { expect, test } from "./support/world-fixture";

// T-177: an element has one note. The chapter details, the figure and place inspectors and
// every Storyboard card that points at the element show and edit that same note.
//
// The test world supplies the element and its cards: the chapter "Vor dem Sturm" has a card
// on the main board and a second one on the check board, Ada has a card on the check board,
// the archive one on the main board, and one card points at an element that does not exist.

async function seededWorld(page: Page) {
  return seedExampleWorld(page, { include: ["base", "edge"], open: false });
}

function saved(page: Page, path: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes(path) &&
      response.request().method() === "PUT" &&
      response.status() === 200,
  );
}

async function typeAtEnd(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(text);
}

function chapterNote(page: Page) {
  return page.getByRole("textbox", { name: "Kapitelnotiz" });
}

/** Opens the world in the text workspace on the chapter whose card the boards carry. */
async function openChapter(page: Page, world: SeededExampleWorld) {
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page
    .locator(".binder-chapter-select")
    .filter({ hasText: world.text("ch.c5.title") })
    .click();
  await expect(page.getByRole("textbox", { name: "Kapiteltitel" })).toHaveValue(
    world.text("ch.c5.title"),
  );
}

async function openStoryboard(page: Page, board: string) {
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();
  const picker = page.getByRole("combobox", { name: "Storyboard auswählen" });
  if (!(await picker.textContent())?.includes(board)) {
    await picker.click();
    await page.getByRole("option", { name: board }).click();
  }
}

function cardNote(page: Page, label: string) {
  return page
    .locator('[data-storyboard-node-kind="reference"]')
    .filter({ hasText: label })
    .getByRole("textbox", { name: `Notiz zu ${label}` });
}

async function storedNote(page: Page, world: SeededExampleWorld) {
  const response = await page.request.get(`/api/manuscript?world=${world.id}`);
  const chapters = (await response.json()).payload.chapters as { id: string; note: string }[];
  return chapters.find((chapter) => chapter.id === world.ids.chapters.cStorm)?.note;
}

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "One note across views; the wide layout shows both.");
  void page;
});

test("a chapter note is the same in the chapter details and on its Storyboard card (19)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  const main = world.text("board.main.title");
  const card = world.text("ch.c5.title");
  const note = world.text("ch.c5.note");
  await openChapter(page, world);
  await expect(chapterNote(page)).toHaveText(note);

  const fromDetails = saved(page, "/api/manuscript");
  await typeAtEnd(page, chapterNote(page), " Aus den Details.");
  await fromDetails;
  await openStoryboard(page, main);
  await expect(cardNote(page, card)).toHaveText(`${note} Aus den Details.`);

  const fromCard = saved(page, "/api/manuscript");
  await typeAtEnd(page, cardNote(page, card), " Von der Karte.");
  await fromCard;
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(chapterNote(page)).toHaveText(`${note} Aus den Details. Von der Karte.`);

  await page.reload();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.locator(".binder-chapter-select").filter({ hasText: card }).click();
  await expect(chapterNote(page)).toHaveText(`${note} Aus den Details. Von der Karte.`);
  await openStoryboard(page, main);
  await expect(cardNote(page, card)).toHaveText(`${note} Aus den Details. Von der Karte.`);
});

test("a figure's note is the same in its profile and on its Storyboard card (20)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  const card = world.text("card.x-ada.label");
  const note = world.text("el.ada.notes");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page, world.text("board.x.title"));
  const fromCard = saved(page, "/api/state");
  await typeAtEnd(page, cardNote(page, card), " Kennt das Archiv.");
  await fromCard;

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page
    .locator(".story-node")
    .filter({ hasText: world.text("el.ada.name") })
    .click();
  const inspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await inspector.getByRole("tab", { name: "Steckbrief" }).click();
  const profileNote = inspector.getByRole("textbox", { name: "Notizen" });
  await expect(profileNote).toHaveText(`${note} Kennt das Archiv.`);

  const fromProfile = saved(page, "/api/state");
  await typeAtEnd(page, profileNote, " Und schweigt.");
  await fromProfile;
  await openStoryboard(page, world.text("board.x.title"));
  await expect(cardNote(page, card)).toHaveText(`${note} Kennt das Archiv. Und schweigt.`);
});

test("a place's note is the same in the place inspector and on its Storyboard card (21)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  const card = world.text("el.archive.name");
  const note = world.text("el.archive.notes");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page, world.text("board.main.title"));
  const fromCard = saved(page, "/api/state");
  await typeAtEnd(page, cardNote(page, card), " Nebel am Kai.");
  await fromCard;

  // The archive stands inside Nordhafen; its level has to be opened first.
  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await page.getByRole("button", { name: `${world.text("el.nordhafen.name")} öffnen` }).click();
  await page
    .locator(`.react-flow__node[data-id="${world.ids.figures.archive}"] .story-node`)
    .click({ position: { x: 12, y: 12 } });
  const inspector = page.locator('[aria-label="Orte-Inspector"]').filter({ visible: true });
  const placeNote = inspector.getByRole("textbox", { name: "Notizen" });
  await expect(placeNote).toHaveText(`${note} Nebel am Kai.`);

  const fromInspector = saved(page, "/api/state");
  await typeAtEnd(page, placeNote, " Möwen.");
  await fromInspector;
  await openStoryboard(page, world.text("board.main.title"));
  await expect(cardNote(page, card)).toHaveText(`${note} Nebel am Kai. Möwen.`);
});

test("two Storyboards with a card on the same chapter show the same note (22)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  const card = world.text("ch.c5.title");
  const note = world.text("ch.c5.note");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page, world.text("board.x.title"));
  const fromSecond = saved(page, "/api/manuscript");
  await typeAtEnd(page, cardNote(page, card), " Zweiter Akt.");
  await fromSecond;

  await openStoryboard(page, world.text("board.main.title"));
  await expect(cardNote(page, card)).toHaveText(`${note} Zweiter Akt.`);
});

test("a card whose element is gone says so and offers no editor", async ({ page }) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page, world.text("board.x.title"));

  const card = page
    .locator('[data-storyboard-node-kind="reference"]')
    .filter({ hasText: world.text("card.x-gone.label") });
  await expect(card.getByText("Element gelöscht")).toBeVisible();
  await expect(card.getByRole("textbox")).toHaveCount(0);
});

test("a card whose chapter sits in the trash says so instead of 'deleted'", async ({ page }) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page, world.text("board.x.title"));

  // The check board's card on the prologue, which the world keeps in the bin.
  const card = page
    .locator('[data-storyboard-node-kind="reference"]')
    .filter({ hasText: world.text("ch.prologue.title") });
  await expect(card.getByText("Kapitel im Papierkorb")).toBeVisible();
  await expect(card.getByText("Element gelöscht")).toHaveCount(0);
  await expect(card.getByRole("textbox")).toHaveCount(0);
});

test("the same chapter note edited in two tabs ends in a visible conflict (23)", async ({
  page,
  context,
}) => {
  const world = await seededWorld(page);
  const card = world.text("ch.c5.title");
  const note = world.text("ch.c5.note");
  const second = await context.newPage();
  try {
    await Promise.all([openChapter(page, world), openChapter(second, world)]);
    await expect(chapterNote(second)).toHaveText(note);
    await openStoryboard(page, world.text("board.main.title"));

    const fromCard = saved(page, "/api/manuscript");
    await typeAtEnd(page, cardNote(page, card), " Tab A.");
    await fromCard;

    const refused = second.waitForResponse(
      (response) =>
        response.url().includes("/api/manuscript") &&
        response.request().method() === "PUT" &&
        response.status() === 409,
    );
    await typeAtEnd(second, chapterNote(second), " Tab B.");
    await refused;

    await expect(second.getByRole("button", { name: "Entwurf retten", exact: true })).toBeVisible();
    await expect(chapterNote(second)).toHaveText(`${note} Tab B.`);
    expect(await storedNote(page, world)).toBe(`${note} Tab A.`);
  } finally {
    await second.close();
  }
});

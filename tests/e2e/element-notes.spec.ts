import type { Locator, Page } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { encodeStoryWorldDocument } from "./support/application-api";
import { putVersioned } from "./support/seed";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-177: an element has one note. The chapter details, the figure and place inspectors and
// every Storyboard card that points at the element show and edit that same note.

async function seededWorld(page: Page) {
  const world = await createTestWorld(page, `Eine Notiz ${crypto.randomUUID()}`);
  await putVersioned(page, `/api/manuscript?world=${world.id}`, (revision) =>
    encodeManuscriptV1(
      { chapters: [{ id: "k1", title: "Ankunft", body: "Der Morgen.", note: "Alt." }] },
      revision,
    ),
  );
  await putVersioned(page, `/api/state?world=${world.id}`, (revision) =>
    encodeStoryWorldDocument(
      {
        nodes: [
          { id: "mira", type: "person", name: "Mira", x: 160, y: 180 },
          { id: "hafen", type: "ort", name: "Hafen", x: 80, y: 80 },
        ],
        edges: [],
      },
      revision,
    ),
  );
  const reference = (id: string, boardId: string, kind: string, target: string, x: number) => ({
    id,
    boardId,
    kind: "reference" as const,
    target: { kind, id: target } as never,
    label: id,
    x,
    y: 60,
  });
  await putVersioned(page, `/api/storyboards?world=${world.id}`, (revision) =>
    encodeStoryboardsV1(
      {
        boards: [
          { id: "main-storyboard", title: "Main Storyboard" },
          { id: "second-board", title: "Zweiter Akt" },
        ],
        nodes: [
          reference("Kapitelkarte", "main-storyboard", "chapter", "k1", 40),
          reference("Figurenkarte", "main-storyboard", "entity", "mira", 320),
          reference("Ortskarte", "main-storyboard", "place", "hafen", 600),
          reference("Verschwunden", "main-storyboard", "chapter", "gone", 880),
          reference("Zweite Kapitelkarte", "second-board", "chapter", "k1", 40),
        ],
        edges: [],
      },
      revision,
    ),
  );
  return world;
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

async function openStoryboard(page: Page, board = "Main Storyboard") {
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

async function storedNote(page: Page, worldId: string) {
  const response = await page.request.get(`/api/manuscript?world=${worldId}`);
  return (await response.json()).payload.chapters[0].note as string;
}

test.beforeEach(({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "One note across views; the wide layout shows both.");
  void page;
});

test("a chapter note is the same in the chapter details and on its Storyboard card (19)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await expect(chapterNote(page)).toHaveText("Alt.");

  const fromDetails = saved(page, "/api/manuscript");
  await typeAtEnd(page, chapterNote(page), " Aus den Details.");
  await fromDetails;
  await openStoryboard(page);
  await expect(cardNote(page, "Kapitelkarte")).toHaveText("Alt. Aus den Details.");

  const fromCard = saved(page, "/api/manuscript");
  await typeAtEnd(page, cardNote(page, "Kapitelkarte"), " Von der Karte.");
  await fromCard;
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await expect(chapterNote(page)).toHaveText("Alt. Aus den Details. Von der Karte.");

  await page.reload();
  await expect(chapterNote(page)).toHaveText("Alt. Aus den Details. Von der Karte.");
  await openStoryboard(page);
  await expect(cardNote(page, "Kapitelkarte")).toHaveText("Alt. Aus den Details. Von der Karte.");
});

test("a figure's note is the same in its profile and on its Storyboard card (20)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page);
  const fromCard = saved(page, "/api/state");
  await typeAtEnd(page, cardNote(page, "Figurenkarte"), "Kennt das Archiv.");
  await fromCard;

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.locator(".story-node").filter({ hasText: "Mira" }).click();
  const inspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await inspector.getByRole("tab", { name: "Steckbrief" }).click();
  const profileNote = inspector.getByRole("textbox", { name: "Notizen" });
  await expect(profileNote).toHaveText("Kennt das Archiv.");

  const fromProfile = saved(page, "/api/state");
  await typeAtEnd(page, profileNote, " Und schweigt.");
  await fromProfile;
  await openStoryboard(page);
  await expect(cardNote(page, "Figurenkarte")).toHaveText("Kennt das Archiv. Und schweigt.");
});

test("a place's note is the same in the place inspector and on its Storyboard card (21)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page);
  const fromCard = saved(page, "/api/state");
  await typeAtEnd(page, cardNote(page, "Ortskarte"), "Nebel am Kai.");
  await fromCard;

  await page.getByRole("button", { name: "Orte", exact: true }).click();
  await page
    .locator('.react-flow__node[data-id="hafen"] .story-node')
    .click({ position: { x: 12, y: 12 } });
  const inspector = page.locator('[aria-label="Orte-Inspector"]').filter({ visible: true });
  const placeNote = inspector.getByRole("textbox", { name: "Notizen" });
  await expect(placeNote).toHaveText("Nebel am Kai.");

  const fromInspector = saved(page, "/api/state");
  await typeAtEnd(page, placeNote, " Möwen.");
  await fromInspector;
  await openStoryboard(page);
  await expect(cardNote(page, "Ortskarte")).toHaveText("Nebel am Kai. Möwen.");
});

test("two Storyboards with a card on the same chapter show the same note (22)", async ({
  page,
}) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page, "Zweiter Akt");
  const fromSecond = saved(page, "/api/manuscript");
  await typeAtEnd(page, cardNote(page, "Zweite Kapitelkarte"), " Zweiter Akt.");
  await fromSecond;

  await openStoryboard(page, "Main Storyboard");
  await expect(cardNote(page, "Kapitelkarte")).toHaveText("Alt. Zweiter Akt.");
});

test("a card whose element is gone says so and offers no editor", async ({ page }) => {
  const world = await seededWorld(page);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await openStoryboard(page);

  const card = page
    .locator('[data-storyboard-node-kind="reference"]')
    .filter({ hasText: "Verschwunden" });
  await expect(card.getByText("Element gelöscht")).toBeVisible();
  await expect(card.getByRole("textbox")).toHaveCount(0);
});

test("the same chapter note edited in two tabs ends in a visible conflict (23)", async ({
  page,
  context,
}) => {
  const world = await seededWorld(page);
  const second = await context.newPage();
  try {
    await Promise.all([page.goto(`/?world=${world.id}`), second.goto(`/?world=${world.id}`)]);
    await expect(chapterNote(second)).toHaveText("Alt.");
    await openStoryboard(page);

    const fromCard = saved(page, "/api/manuscript");
    await typeAtEnd(page, cardNote(page, "Kapitelkarte"), " Tab A.");
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
    await expect(chapterNote(second)).toHaveText("Alt. Tab B.");
    expect(await storedNote(page, world.id)).toBe("Alt. Tab A.");
  } finally {
    await second.close();
  }
});

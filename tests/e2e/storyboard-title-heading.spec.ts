import type { Page } from "@playwright/test";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { encodeStoryWorldDocument } from "./support/application-api";
import { putVersioned } from "./support/seed";
import { createTestWorld, expect, test } from "./support/world-fixture";

// T-185: a note that opens with its card's own title as a heading does not repeat it on the
// Storyboard card. Display only: the note keeps the heading, the profile shows it, and the
// card shows it again while somebody writes.

const heading = (to: number, from = 0) => ({
  from,
  to,
  kind: "heading" as const,
  level: 1 as const,
});

async function seededWorld(page: Page) {
  const world = await createTestWorld(page, `Titelzeile ${crypto.randomUUID()}`);
  await putVersioned(page, `/api/manuscript?world=${world.id}`, (revision) =>
    encodeManuscriptV1(
      {
        chapters: [
          {
            id: "k1",
            title: "Ankunft",
            body: "Der Morgen.",
            note: "Anderer Titel\nDer Kai liegt still.",
            noteMarks: [heading(13)],
          },
        ],
      },
      revision,
    ),
  );
  await putVersioned(page, `/api/state?world=${world.id}`, (revision) =>
    encodeStoryWorldDocument(
      {
        nodes: [
          {
            id: "mira",
            type: "person",
            name: "Mira",
            x: 160,
            y: 180,
            profile: {
              notes: "Figurenkarte\n\nKennt das Archiv.",
              noteMarks: [heading(12)],
            },
          },
          {
            id: "hafen",
            type: "ort",
            name: "Hafen",
            x: 80,
            y: 80,
            profile: {
              notes: "Vorspann\nOrtskarte\nNebel am Kai.",
              noteMarks: [heading(18, 9)],
            },
          },
        ],
        edges: [],
      },
      revision,
    ),
  );
  const reference = (id: string, kind: string, target: string, x: number) => ({
    id,
    boardId: "main-storyboard",
    kind: "reference" as const,
    target: { kind, id: target } as never,
    label: id,
    x,
    y: 60,
  });
  await putVersioned(page, `/api/storyboards?world=${world.id}`, (revision) =>
    encodeStoryboardsV1(
      {
        boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
        nodes: [
          reference("Kapitelkarte", "chapter", "k1", 40),
          reference("Figurenkarte", "entity", "mira", 320),
          reference("Ortskarte", "place", "hafen", 600),
        ],
        edges: [],
      },
      revision,
    ),
  );
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  return world;
}

function cardNote(page: Page, label: string) {
  return page
    .locator('[data-storyboard-node-kind="reference"]')
    .filter({ hasText: label })
    .getByRole("textbox", { name: `Notiz zu ${label}` });
}

function noteLine(page: Page, label: string, text: string) {
  return cardNote(page, label).locator(".cm-line").filter({ hasText: text });
}

test.beforeEach(({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "One card layout; the wide project shows both views.",
  );
  void page;
});

test("a heading equal to the card title is left out of the card, not of the note", async ({
  page,
}) => {
  await seededWorld(page);
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  await expect(noteLine(page, "Figurenkarte", "Kennt das Archiv.")).toBeVisible();
  await expect(noteLine(page, "Figurenkarte", "Figurenkarte")).toBeHidden();
  // The note itself still starts with the heading.
  await expect(cardNote(page, "Figurenkarte")).toContainText("Figurenkarte");

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await page.locator(".story-node").filter({ hasText: "Mira" }).click();
  const inspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  await inspector.getByRole("tab", { name: "Steckbrief" }).click();
  const profile = inspector.getByRole("textbox", { name: "Notizen" });
  await expect(profile.locator(".cm-line").filter({ hasText: "Figurenkarte" })).toBeVisible();
});

test("the card shows the heading again while somebody writes in it", async ({ page }) => {
  await seededWorld(page);
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  await cardNote(page, "Figurenkarte").click();
  await expect(noteLine(page, "Figurenkarte", "Figurenkarte")).toBeVisible();
});

test("a different heading, or the same one further down, stays on the card", async ({ page }) => {
  await seededWorld(page);
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  await expect(noteLine(page, "Kapitelkarte", "Anderer Titel")).toBeVisible();
  await expect(noteLine(page, "Ortskarte", "Vorspann")).toBeVisible();
  await expect(noteLine(page, "Ortskarte", "Ortskarte")).toBeVisible();
});

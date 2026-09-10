import type { Locator, Page } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

const longMiddleChapter = [
  ...Array.from(
    { length: 70 },
    (_, index) =>
      `Absatz ${index + 1}: Der Wind strich durch die hohen Baeume und trug den Duft des Regens ins Tal.`,
  ),
  "Am Ende wartet der Zielpunkt.",
].join("\n");

const manuscript = {
  chapters: [
    { id: "c1", title: "Erstes Kapitel", body: "Der Anfang bleibt ruhig.", note: "" },
    { id: "c2", title: "Zweites Kapitel", body: longMiddleChapter, note: "" },
    {
      id: "c3",
      title: "Drittes Kapitel",
      body: "Hinter dem Huegel stand die Sternwarte unter einem klaren Himmel.",
      note: "",
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await mockRequiredWorldDocuments(page, {
    manuscript,
    storyWorld: { nodes: [], edges: [] },
  });
});

async function openWorld(page: Page, title: string) {
  const world = await createTestWorld(page, title);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
}

async function selectChapter(page: Page, chapter: number, title: string) {
  const binder = page.getByRole("complementary", { name: "Kapitel" });
  if (!(await binder.isVisible())) {
    await page.getByRole("button", { name: "Kapitelnavigation öffnen" }).click();
  }
  await binder.getByRole("button", { name: new RegExp(`^${chapter} ${title} `) }).click();
  await expect(page.getByLabel("Kapiteltitel")).toHaveValue(title);
}

async function editorText(editor: Locator) {
  return (await editor.locator(".cm-line").allInnerTexts()).join("\n");
}

async function selectionOffsets(editor: Locator) {
  return editor.evaluate((root) => {
    const selection = document.getSelection();
    if (
      !selection?.anchorNode ||
      !selection.focusNode ||
      !root.contains(selection.anchorNode) ||
      !root.contains(selection.focusNode)
    ) {
      return null;
    }
    const offsetTo = (node: Node, offset: number) => {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(node, offset);
      return range.toString().length;
    };
    return {
      anchor: offsetTo(selection.anchorNode, selection.anchorOffset),
      head: offsetTo(selection.focusNode, selection.focusOffset),
      text: selection.toString(),
    };
  });
}

async function switchWorkspace(page: Page, name: "Text" | "Figuren") {
  await page.getByRole("button", { name, exact: true }).click();
  if (name === "Text") {
    await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  } else {
    await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
  }
}

async function returnToWorldSelection(page: Page) {
  await page.getByRole("button", { name: "Mehr", exact: true }).click();
  await page.getByRole("menuitem", { name: "Zur Weltauswahl", exact: true }).click();
}

test("Returning to Text restores the edited chapter, cursor, scroll and input focus", async ({
  page,
}) => {
  await openWorld(page, "Editor-Sitzung Cursor");
  const nextChapter = page.getByRole("button", {
    name: /^Nächstes Kapitel: Kapitel 2 · Zweites Kapitel/,
  });
  await nextChapter.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Zweites Kapitel");

  const editor = page.getByLabel("Kapiteltext");
  const scroller = page.locator(".editor-scroll");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const lastLine = editor.locator(".cm-line").filter({ hasText: "Am Ende wartet der Zielpunkt." });
  await lastLine.click();
  await page.keyboard.press("End");
  for (let index = 0; index < "punkt.".length; index += 1) {
    await page.keyboard.press("ArrowLeft");
  }
  await page.keyboard.type("X");
  await expect.poll(() => editorText(editor)).toContain("Am Ende wartet der ZielXpunkt.");

  const savedScrollTop = await scroller.evaluate((element) => {
    const target = Math.round((element.scrollHeight - element.clientHeight) * 0.58);
    element.scrollTop = target;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop;
  });
  expect(savedScrollTop).toBeGreaterThan(0);

  await switchWorkspace(page, "Figuren");
  await switchWorkspace(page, "Text");

  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Zweites Kapitel");
  await expect(editor).toBeFocused();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(savedScrollTop);

  await page.keyboard.type("Y");
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect.poll(() => editorText(editor)).toContain("Am Ende wartet der ZielXYpunkt.");
});

test("Returning to Text restores a reversed selection for exact replacement", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Selection direction is independent of viewport and covered in the wide editor.",
  );
  await openWorld(page, "Editor-Sitzung Auswahl");
  await selectChapter(page, 1, "Erstes Kapitel");

  const editor = page.getByLabel("Kapiteltext");
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < "Der Anfang".length; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  for (let index = 0; index < "Anfang".length; index += 1) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  const reversed = await selectionOffsets(editor);
  expect(reversed).toEqual({ anchor: 10, head: 4, text: "Anfang" });

  await switchWorkspace(page, "Figuren");
  await switchWorkspace(page, "Text");

  await expect(editor).toBeFocused();
  await expect.poll(() => selectionOffsets(editor)).toEqual(reversed);
  await page.keyboard.type("Beginn");
  await expect.poll(() => editorText(editor)).toBe("Der Beginn bleibt ruhig.");
});

test("Explicit search navigation overrides a snapshot without leaving a stale chapter target", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Target consumption is viewport-independent and covered with the visible wide binder.",
  );
  await openWorld(page, "Editor-Sitzung Navigation");
  await selectChapter(page, 2, "Zweites Kapitel");

  const editor = page.getByLabel("Kapiteltext");
  await editor.click();
  await page.keyboard.press("Control+End");
  await switchWorkspace(page, "Figuren");

  await page.keyboard.press("Control+KeyF");
  const palette = page.getByRole("dialog", { name: "Suchen & Befehle" });
  await palette.getByLabel("Suchbegriff").fill("Sternwarte");
  await palette.getByRole("option", { name: /Drittes Kapitel/ }).click();

  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Drittes Kapitel");
  await expect(editor.locator(".text-search-match.is-active")).toHaveText("Sternwarte");

  await selectChapter(page, 1, "Erstes Kapitel");
  await editor.click();
  await page.keyboard.press("Control+End");
  await switchWorkspace(page, "Figuren");
  await switchWorkspace(page, "Text");

  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Erstes Kapitel");
  await expect(editor).toBeFocused();
  await page.keyboard.type("X");
  await expect.poll(() => editorText(editor)).toBe("Der Anfang bleibt ruhig.X");
});

test("Editor session state does not cross worlds with matching chapter IDs", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "World-keyed in-memory state is viewport-independent and covered in the wide editor.",
  );
  const firstWorld = await createTestWorld(page, "Editor-Sitzung Welt A");
  await createTestWorld(page, "Editor-Sitzung Welt B");
  await page.goto(`/?world=${firstWorld.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await selectChapter(page, 2, "Zweites Kapitel");
  const editor = page.getByLabel("Kapiteltext");
  await editor.click();
  await page.keyboard.press("Control+End");
  await switchWorkspace(page, "Figuren");

  await returnToWorldSelection(page);
  await page
    .getByRole("button", { name: "Editor-Sitzung Welt B – Welt öffnen", exact: true })
    .click();
  await switchWorkspace(page, "Text");
  await expect(page.getByRole("banner")).toContainText("Editor-Sitzung Welt B");
  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Erstes Kapitel");
});

test("Editor session state does not survive a page reload", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "In-memory lifetime is viewport-independent and covered in the wide editor.",
  );
  await openWorld(page, "Editor-Sitzung Neuladen");
  await selectChapter(page, 3, "Drittes Kapitel");
  const editor = page.getByLabel("Kapiteltext");
  await editor.click();
  await page.keyboard.press("Control+End");
  await switchWorkspace(page, "Figuren");
  await page.reload();

  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Erstes Kapitel");
});

import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import type { Manuscript } from "../../packages/client/src/modules/manuscript";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

const manuscript: Manuscript = {
  chapters: [
    {
      id: "second",
      title: "2. Aufbruch",
      body: "Sie ging an Bord.\n\n⁂\n\nEin neuer Tag.",
      note: "Private Planung",
    },
    {
      id: "first",
      title: "1. Ankunft",
      body: "😀 Der Morgen lag still.\nEin Schiff wartete.\n\nAnna blieb.",
      note: "",
      marks: [
        { from: 0, to: 13, kind: "bold" },
        { from: 24, to: 34, kind: "italic" },
      ],
    },
    {
      id: "aside",
      title: "Reservekapitel",
      body: "Nicht für den Export.",
      note: "",
      inBook: false,
    },
  ],
  structure: {
    folders: [{ id: "part", title: "Erster Teil" }],
    items: [
      { id: "folder", kind: "folder", folderId: "part", position: 0 },
      { id: "item1", kind: "chapter", chapterId: "first", parentFolderId: "part", position: 0 },
      { id: "item2", kind: "chapter", chapterId: "second", parentFolderId: "part", position: 1 },
      { id: "item3", kind: "chapter", chapterId: "aside", position: 1 },
    ],
  },
};

async function seed(page: Page) {
  const world = await createTestWorld(page, "DOCX-Exportprüfung");
  const current = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": `"${current.revision}"` },
    data: encodeManuscriptV1(manuscript, current.revision),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  return world;
}

async function openExport(page: Page, preset: "editor" | "normseite") {
  await page.getByRole("button", { name: "Buch exportieren", exact: true }).click();
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/manuscript-export/preview"),
  );
  await page
    .getByRole("menuitem", {
      name: preset === "editor" ? "DOCX fürs Lektorat" : "DOCX als Normseite",
      exact: true,
    })
    .click();
  const previewResponse = await response;
  expect(previewResponse.ok(), await previewResponse.text()).toBe(true);
  const dialog = page.getByRole("dialog", { name: "DOCX-Inhalt prüfen", exact: true });
  await expect(dialog.getByRole("heading", { name: "1. Ankunft", exact: true })).toBeVisible();
  return { dialog, preview: (await previewResponse.json()).preview };
}

for (const theme of ["light", "dark"] as const) {
  for (const preset of ["editor", "normseite"] as const) {
    test(`DOCX ${preset} reviews and downloads a lossless book in ${theme} mode`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const world = await seed(page);
      const before = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
      const { dialog, preview } = await openExport(page, preset);
      expect(preview.chapters.map((chapter: { id: string }) => chapter.id)).toEqual([
        "first",
        "second",
      ]);
      expect(preview.counts).toEqual({
        manuscriptChapters: 3,
        manuscriptWords: 22,
        exportedChapters: 2,
        exportedWords: 18,
      });
      await expect(dialog.getByText("Private Planung", { exact: true })).toHaveCount(0);
      await expect(
        dialog.getByText("Nicht enthaltene Kapitelnotizen: 1", { exact: true }),
      ).toBeVisible();
      const downloadButton = dialog.getByRole("button", {
        name: "DOCX herunterladen",
        exact: true,
      });
      await expect(downloadButton).toBeDisabled();
      const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      expect(accessibility.violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath(`docx-export-${preset}-${theme}.png`) });
      await dialog
        .getByRole("checkbox", { name: "Alle angezeigten Hinweise wurden geprüft" })
        .check();
      const downloadEvent = page.waitForEvent("download");
      await downloadButton.click();
      const downloaded = await downloadEvent;
      expect(downloaded.suggestedFilename()).toBe(
        preset === "editor" ? "Quiltor-Manuskript.docx" : "Quiltor-Normseite.docx",
      );
      await downloaded.saveAs(testInfo.outputPath(downloaded.suggestedFilename()));
      const bytes = await readFile(testInfo.outputPath(downloaded.suggestedFilename()));
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      const roundTrip = await page.request.post("/api/manuscript-import/preview", {
        data: { fileName: downloaded.suggestedFilename(), dataBase64: bytes.toString("base64") },
      });
      expect(roundTrip.ok(), await roundTrip.text()).toBe(true);
      const imported = (await roundTrip.json()).preview;
      const expected = [manuscript.chapters[1], manuscript.chapters[0]];
      expect(
        imported.chapters.map((chapter: { title: string; body: string; marks: unknown[] }) => ({
          title: chapter.title,
          body: chapter.body,
          marks: chapter.marks,
        })),
      ).toEqual(
        expected.map((chapter) => ({
          title: chapter.title,
          body: chapter.body,
          marks: chapter.marks ?? [],
        })),
      );
      const after = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
      expect(after).toEqual(before);
      expect(errors).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Buch exportieren", exact: true }),
      ).toBeFocused();
    });
  }
}

test("DOCX rejects a stale review and reloads the changed manuscript", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The revision conflict is covered once.");
  const world = await seed(page);
  const { dialog } = await openExport(page, "editor");
  const current = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  current.payload.chapters[0].body += " Neuer Schluss.";
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, { data: current });
  expect(saved.ok()).toBe(true);
  await dialog.getByRole("checkbox", { name: "Alle angezeigten Hinweise wurden geprüft" }).check();
  const rejected = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/manuscript-export/docx"),
  );
  await dialog.getByRole("button", { name: "DOCX herunterladen", exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(dialog.getByRole("alert")).toContainText(
    "Das Manuskript hat sich seit der Vorschau geändert",
  );
  await expect(
    dialog.getByRole("button", { name: "DOCX herunterladen", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Vorschau neu laden", exact: true }).click();
  await expect(dialog.getByText(/Neuer Schluss\./)).toBeVisible();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
});

test("DOCX review reflows with doubled text at 320 pixels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The explicit 320-pixel viewport is covered once.");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page);
  const { dialog } = await openExport(page, "normseite");
  await dialog.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll<HTMLElement>("*")];
    const sizes = elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => {
      (element as HTMLElement).style.transition = "none";
      (element as HTMLElement).style.fontSize = `${sizes[index] * 2}px`;
    });
  });
  const overflow = await dialog.evaluate((root) =>
    [
      root,
      ...root.querySelectorAll<HTMLElement>(".dialog-content, .manuscript-export-dialog, button"),
    ]
      .map((element) => ({
        className: element.className,
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }))
      .filter((element) => element.scroll > element.client + 1),
  );
  expect(overflow).toEqual([]);
  await dialog.getByRole("checkbox").check();
  await expect(
    dialog.getByRole("button", { name: "DOCX herunterladen", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("docx-export-reflow.png") });
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

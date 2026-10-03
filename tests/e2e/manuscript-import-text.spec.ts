import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { expect, registerTestWorld, test } from "./support/world-fixture";

const markdownFixture = new URL("../fixtures/manuscript-import/harbor.md", import.meta.url);
const previewPath = "/api/manuscript-import/v2/preview";
const importPath = "/api/manuscript-import/v2/import";

for (const theme of ["light", "dark"] as const) {
  test(`Markdown import splits paragraphs and retains nested folders in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
    const previewResponse = page.waitForResponse((response) =>
      response.url().endsWith(previewPath),
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "Hafenroman.markdown",
      mimeType: "text/markdown",
      buffer: await readFile(markdownFixture),
    });
    const original = (await (await previewResponse).json()).preview;
    expect(original.format).toBe("markdown");
    expect(original.units).toHaveLength(7);
    expect(original.chapters).toHaveLength(3);
    expect(original.chapters[0]).toMatchObject({
      sourceIndexes: [0, 1, 2],
      title: "Der Hafen",
      body: "😀 Der Morgen lag still über dem Hafen.\n\nAnna packte leise ihren Koffer.",
      marks: [
        { from: 0, to: 13, kind: "bold" },
        { from: 53, to: 58, kind: "italic" },
      ],
    });
    const title = `Markdown ${crypto.randomUUID()}`;
    await dialog.getByLabel("Projekttitel", { exact: true }).fill(title);
    await dialog.getByText("Kapitel 1 teilen", { exact: true }).click();
    await dialog.getByRole("button", { name: /^Vor Absatz 3 teilen:/ }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("Titel von Kapitel 2", { exact: true })).toBeFocused();
    await dialog.getByLabel("Titel von Kapitel 2", { exact: true }).fill("Aufbruch");
    await dialog.getByLabel("Ordnerpfad für Kapitel 1", { exact: true }).fill("Teil I / Hafen");
    await dialog.getByLabel("Ordnerpfad für Kapitel 2", { exact: true }).fill("Teil I / Hafen");
    await dialog.getByLabel("Ordnerpfad für Kapitel 3", { exact: true }).fill("Teil I / Reise");
    const confirm = dialog.getByRole("button", {
      name: "Als neues Projekt importieren",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    const updatedResponse = page.waitForResponse((response) =>
      response.url().endsWith(previewPath),
    );
    await dialog.getByRole("button", { name: "Vorschau aktualisieren", exact: true }).click();
    const revised = (await (await updatedResponse).json()).preview;
    expect(
      revised.chapters.map((chapter: { sourceIndexes: number[] }) => chapter.sourceIndexes),
    ).toEqual([[0, 1], [2], [3, 4], [5, 6]]);
    expect(revised.counts).toEqual(original.counts);
    expect(revised.chapters[1]).toMatchObject({
      body: "Anna packte leise ihren Koffer.",
      marks: [{ from: 12, to: 17, kind: "italic" }],
    });
    expect(revised.chapters.map((chapter: { folderPath: string[] }) => chapter.folderPath)).toEqual(
      [["Teil I", "Hafen"], ["Teil I", "Hafen"], ["Teil I", "Reise"], []],
    );
    for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
    await expect(confirm).toBeEnabled();
    await confirm.evaluate(async (button) => {
      await Promise.all(
        button.getAnimations({ subtree: true }).map((animation) => animation.finished),
      );
    });
    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`markdown-preview-${theme}.png`) });
    const importedResponse = page.waitForResponse((response) =>
      response.url().endsWith(importPath),
    );
    await confirm.click();
    const imported = await importedResponse;
    expect(imported.status()).toBe(201);
    const world = (await imported.json()).world;
    registerTestWorld(page, world.id);
    await expect(page.getByLabel("Kapiteltext")).toContainText(revised.chapters[0].body);
    await page.reload();
    await page.getByRole("button", { name: `${title} – Welt öffnen`, exact: true }).click();
    await expect(page.getByLabel("Kapiteltext")).toContainText(revised.chapters[0].body);
    const persisted = (await (await page.request.get(`/api/manuscript?world=${world.id}`)).json())
      .payload;
    expect(
      persisted.chapters.map(
        ({ title, body, marks }: { title: string; body: string; marks: unknown }) => ({
          title,
          body,
          marks,
        }),
      ),
    ).toEqual(
      revised.chapters.map(
        ({ title, body, marks }: { title: string; body: string; marks: unknown }) => ({
          title,
          body,
          marks,
        }),
      ),
    );
    const folders = persisted.structure.folders as { id: string; title: string }[];
    const items = persisted.structure.items as {
      kind: string;
      folderId?: string;
      chapterId?: string;
      parentFolderId?: string;
      position: number;
    }[];
    expect(folders.map((folder) => folder.title).sort()).toEqual(["Hafen", "Reise", "Teil I"]);
    const folder = (name: string) => folders.find((entry) => entry.title === name)?.id;
    expect(items.find((item) => item.folderId === folder("Hafen"))?.parentFolderId).toBe(
      folder("Teil I"),
    );
    expect(items.find((item) => item.folderId === folder("Reise"))?.parentFolderId).toBe(
      folder("Teil I"),
    );
    expect(
      persisted.chapters.map(
        (chapter: { id: string }) =>
          items.find((item) => item.chapterId === chapter.id)?.parentFolderId,
      ),
    ).toEqual([folder("Hafen"), folder("Hafen"), folder("Reise"), undefined]);
    expect(persisted.importSource).toMatchObject({
      version: 2,
      format: "markdown",
      counts: revised.counts,
    });
  });
}

test("TXT import rejects undecodable input and preserves UTF-16 paragraphs after splitting", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Encoding behavior is covered once at desktop width.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
  let publicationRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith(importPath)) publicationRequests += 1;
  });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Ungültig.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xff, 0xfe, 0x41]),
  });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Als neues Projekt importieren", exact: true }),
  ).toBeDisabled();
  expect(publicationRequests).toBe(0);
  const source = "😀 Der Hafen.\r\nNoch derselbe Absatz.\r\n\r\nAnna reist.\r\n\r\n";
  const previewResponse = page.waitForResponse((response) => response.url().endsWith(previewPath));
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Hafen.txt",
    mimeType: "text/plain",
    buffer: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, "utf16le")]),
  });
  const original = (await (await previewResponse).json()).preview;
  expect(original.format).toBe("txt");
  expect(original.chapters).toHaveLength(1);
  expect(original.chapters[0].body).toBe(source.replaceAll("\r\n", "\n"));
  await dialog.getByText("Kapitel 1 teilen", { exact: true }).click();
  await dialog.getByRole("button", { name: /^Vor Absatz 2 teilen:/ }).click();
  const updatedResponse = page.waitForResponse((response) => response.url().endsWith(previewPath));
  await dialog.getByRole("button", { name: "Vorschau aktualisieren", exact: true }).click();
  const revised = (await (await updatedResponse).json()).preview;
  expect(revised.chapters).toHaveLength(2);
  expect(revised.chapters.map((chapter: { body: string }) => chapter.body).join("\n\n")).toBe(
    source.replaceAll("\r\n", "\n"),
  );
  expect(revised.counts).toEqual(original.counts);
  const importedResponse = page.waitForResponse((response) => response.url().endsWith(importPath));
  await dialog.getByRole("button", { name: "Als neues Projekt importieren", exact: true }).click();
  const imported = await importedResponse;
  expect(imported.status()).toBe(201);
  const world = (await imported.json()).world;
  registerTestWorld(page, world.id);
  const persisted = (await (await page.request.get(`/api/manuscript?world=${world.id}`)).json())
    .payload;
  expect(persisted.chapters.map((chapter: { body: string }) => chapter.body)).toEqual(
    revised.chapters.map((chapter: { body: string }) => chapter.body),
  );
  expect(persisted.importSource).toMatchObject({
    version: 2,
    format: "txt",
    counts: original.counts,
  });
});

test("Markdown folder conflicts keep the chapter plan editable before publication", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Folder conflict recovery is covered once at desktop width.",
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Hafenroman.md",
    mimeType: "text/markdown",
    buffer: await readFile(markdownFixture),
  });
  const first = dialog.getByLabel("Ordnerpfad für Kapitel 1", { exact: true });
  const third = dialog.getByLabel("Ordnerpfad für Kapitel 3", { exact: true });
  await first.fill("Teil I");
  await third.fill("Teil I");
  const rejectedResponse = page.waitForResponse((response) => response.url().endsWith(previewPath));
  await dialog.getByRole("button", { name: "Vorschau aktualisieren", exact: true }).click();
  expect((await rejectedResponse).status()).toBe(400);
  await expect(dialog.getByRole("alert").filter({ hasText: /Ordnerreihenfolge/ })).toBeVisible();
  await expect(first).toHaveValue("Teil I");
  await expect(third).toHaveValue("Teil I");
  const confirm = dialog.getByRole("button", {
    name: "Als neues Projekt importieren",
    exact: true,
  });
  await expect(confirm).toBeDisabled();
  await third.fill("");
  const acceptedResponse = page.waitForResponse((response) => response.url().endsWith(previewPath));
  await dialog.getByRole("button", { name: "Vorschau aktualisieren", exact: true }).click();
  expect((await acceptedResponse).status()).toBe(200);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  await expect(confirm).toBeEnabled();
});

test("Import controls reflow at 320 pixels with doubled text size", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The explicit 320-pixel viewport is tested once.");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Hafenroman.md",
    mimeType: "text/markdown",
    buffer: await readFile(markdownFixture),
  });
  await expect(dialog.getByLabel("Titel von Kapitel 1", { exact: true })).toBeVisible();
  const sizes = await dialog.evaluate((root) => {
    const elements = [root, ...root.querySelectorAll("*")].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const originals = elements.map((element) => ({
      element,
      size: Number.parseFloat(getComputedStyle(element).fontSize),
    }));
    const sample = root.querySelector("p") as HTMLElement;
    const before = Number.parseFloat(getComputedStyle(sample).fontSize);
    for (const { element, size } of originals) {
      element.style.setProperty("transition", "none", "important");
      element.style.setProperty("font-size", `${size * 2}px`, "important");
    }
    return { before, after: Number.parseFloat(getComputedStyle(sample).fontSize) };
  });
  expect(sizes.after).toBe(sizes.before * 2);
  const overflow = await dialog.evaluate((root) =>
    [
      root,
      ...root.querySelectorAll(
        ".ui-dialog__content,.manuscript-import-dialog,.manuscript-import-preview,.manuscript-import-warnings,.manuscript-import-chapters,.manuscript-import-actions",
      ),
    ]
      .filter((element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({
        className: element.className,
        width: element.clientWidth,
        scroll: element.scrollWidth,
      })),
  );
  expect(overflow).toEqual([]);
  const titleFits = await dialog.evaluate((root) => {
    const header = root.querySelector("header")!.getBoundingClientRect();
    const title = root.querySelector("h2")!.getBoundingClientRect();
    return title.top >= header.top && title.bottom <= header.bottom;
  });
  expect(titleFits).toBe(true);
  const confirm = dialog.getByRole("button", {
    name: "Als neues Projekt importieren",
    exact: true,
  });
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  expect(
    await confirm
      .locator(".ui-button__label")
      .evaluate((label) => label.scrollWidth <= label.clientWidth + 1),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("import-text200-320.png") });
});

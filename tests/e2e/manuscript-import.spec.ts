import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
import { createTestWorld, expect, registerTestWorld, test } from "./support/world-fixture";

const fixture = new URL("../fixtures/manuscript-import/harbor.docx", import.meta.url);
const mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

for (const theme of ["light", "dark"] as const) {
  test(`DOCX import reviews formatting and merged chapters in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const existing = await createTestWorld(page, `Unverändert ${crypto.randomUUID()}`);
    const existingBefore = await (
      await page.request.get(`/api/manuscript?world=${existing.id}`)
    ).json();
    await page.goto("/");
    await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
    const confirm = dialog.getByRole("button", {
      name: "Als neues Projekt importieren",
      exact: true,
    });
    await expect(confirm).toBeDisabled();
    const previewResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/manuscript-import/v2/preview"),
    );
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "Hafenroman.docx",
      mimeType,
      buffer: await readFile(fixture),
    });
    const originalPreview = (await (await previewResponse).json()).preview;
    expect(originalPreview.chapters).toHaveLength(3);
    expect(originalPreview.chapters[0]).toMatchObject({
      title: "Der Hafen",
      body: "😀 Der Morgen lag still über dem Hafen.",
      marks: [{ from: 0, to: 13, kind: "bold" }],
    });
    expect(originalPreview.chapters[1].marks).toEqual([{ from: 0, to: 15, kind: "italic" }]);
    expect(originalPreview.warnings).toContainEqual({ code: "hyperlinks", count: 1 });
    expect(originalPreview.counts).toEqual({
      sourceWords: 19,
      sourceParagraphs: 6,
      importedWords: 19,
      importedParagraphs: 6,
    });
    await expect(confirm).toBeDisabled();

    const title = `Hafenroman ${crypto.randomUUID()}`;
    await dialog.getByLabel("Projekttitel", { exact: true }).fill(title);
    await dialog
      .getByRole("button", { name: /Mit vorherigem Kapitel zusammenführen/ })
      .last()
      .click();
    await expect(confirm).toBeDisabled();
    const revisedResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/manuscript-import/v2/preview"),
    );
    await dialog.getByRole("button", { name: "Vorschau aktualisieren", exact: true }).click();
    const revised = (await (await revisedResponse).json()).preview;
    expect(revised.chapters).toHaveLength(2);
    expect(revised.counts).toEqual(originalPreview.counts);
    expect(revised.chapters[1]).toMatchObject({
      sourceIndexes: [2, 3, 4, 5],
      body: "Anna brach auf.\n\nDie Rückkehr\n\nZuhause wartete Licht.",
      marks: [{ from: 0, to: 15, kind: "italic" }],
    });
    await dialog.getByText("Kapiteltext prüfen: Die Reise", { exact: true }).click();
    await expect(dialog).toContainText("Die Rückkehr");
    await expect(confirm).toBeDisabled();
    for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
    await expect(confirm).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    const accessibility = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`docx-preview-${theme}.png`) });

    const importedResponse = page.waitForResponse((response) =>
      response.url().endsWith("/api/manuscript-import/v2/import"),
    );
    await confirm.click();
    const response = await importedResponse;
    expect(response.status()).toBe(201);
    const imported = await response.json();
    registerTestWorld(page, imported.world.id);
    expect(imported.world.id).not.toBe(existing.id);
    await expect(page.getByLabel("Kapiteltext")).toContainText(revised.chapters[0].body);
    await page.reload();
    await page.getByRole("button", { name: `${title} – Welt öffnen`, exact: true }).click();
    await expect(page.getByLabel("Kapiteltext")).toContainText(revised.chapters[0].body);
    const persisted = (
      await (await page.request.get(`/api/manuscript?world=${imported.world.id}`)).json()
    ).payload;
    expect(
      persisted.chapters.map((chapter: { title: string; body: string; marks: unknown }) => ({
        title: chapter.title,
        body: chapter.body,
        marks: chapter.marks,
      })),
    ).toEqual(
      revised.chapters.map(
        ({ title, body, marks }: { title: string; body: string; marks: unknown }) => ({
          title,
          body,
          marks,
        }),
      ),
    );
    expect(persisted.importSource).toMatchObject({
      version: 2,
      format: "docx",
      fileName: "Hafenroman.docx",
      sourceSha256: revised.sourceSha256,
      counts: revised.counts,
      warnings: revised.warnings,
    });
    if (theme === "light" && testInfo.project.name === "wide") {
      const saved = page.waitForResponse(
        (response) =>
          response.url().includes(`/api/manuscript?world=${imported.world.id}`) &&
          response.request().method() === "PUT" &&
          response.status() === 200,
      );
      await page.getByLabel("Kapiteltext").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" Weiter.");
      await saved;
      const edited = (
        await (await page.request.get(`/api/manuscript?world=${imported.world.id}`)).json()
      ).payload;
      expect(edited.chapters[0].body).toBe(`${revised.chapters[0].body} Weiter.`);
      expect(edited.importSource).toEqual(persisted.importSource);
    }
    const existingAfter = await (
      await page.request.get(`/api/manuscript?world=${existing.id}`)
    ).json();
    expect(existingAfter).toEqual(existingBefore);
  });
}

test("DOCX import retries a lost committed response without creating a second project", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Network retry is covered once at desktop width.");
  await page.goto("/");
  await page.getByRole("button", { name: "Manuskript importieren", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Manuskript importieren", exact: true });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Hafenroman.docx",
    mimeType,
    buffer: await readFile(fixture),
  });
  await expect(dialog.getByRole("checkbox").first()).toBeVisible();
  for (const checkbox of await dialog.getByRole("checkbox").all()) await checkbox.check();
  const confirm = dialog.getByRole("button", {
    name: "Als neues Projekt importieren",
    exact: true,
  });
  let publishedId = "";
  let firstRequestId = "";
  await page.route(
    "**/api/manuscript-import/v2/import",
    async (route) => {
      firstRequestId = route.request().postDataJSON().requestId;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      publishedId = (await response.json()).world.id;
      registerTestWorld(page, publishedId);
      await route.abort("connectionfailed");
    },
    { times: 1 },
  );
  await confirm.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(confirm).toBeEnabled();
  const retried = page.waitForResponse((response) =>
    response.url().endsWith("/api/manuscript-import/v2/import"),
  );
  await confirm.click();
  const response = await retried;
  expect(response.request().postDataJSON().requestId).toBe(firstRequestId);
  const returnedId = (await response.json()).world.id;
  registerTestWorld(page, returnedId);
  expect(returnedId).toBe(publishedId);
  await expect(page.getByLabel("Kapiteltext")).toContainText("😀 Der Morgen");
});

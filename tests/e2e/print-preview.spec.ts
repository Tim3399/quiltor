import type { Page } from "@playwright/test";
import { DEFAULT_BOOK_LAYOUT, type Manuscript } from "../../packages/client/src/modules/manuscript";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

const paragraph =
  "Der Morgen lag still über dem Hafen. Zwischen den Häusern zog Nebel auf, und am Kai wartete Anna auf das erste Schiff. Sie hörte Schritte hinter sich und wandte sich langsam um. ";
const manuscript: Manuscript = {
  bookLayout: {
    ...DEFAULT_BOOK_LAYOUT,
    bookTitle: "Die Stadt am Wasser",
    author: "Anna Beispiel",
    showDate: false,
    showVersion: false,
  },
  chapters: [
    {
      id: "c1",
      title: "Ankunft",
      note: "",
      body:
        "Startpunkt am Hafen.\n\n" +
        Array.from({ length: 65 }, (_, i) => `${paragraph.repeat(3)} Absatz ${i + 1}.`).join(
          "\n\n",
        ),
    },
    {
      id: "c2",
      title: "Das Versprechen",
      note: "",
      body: `${paragraph.repeat(8)}\n\n⁂\n\n${paragraph.repeat(8)}`,
    },
    { id: "c3", title: "Aufbruch", note: "", body: paragraph.repeat(4) },
  ],
};

async function seed(page: Page, book = manuscript) {
  const world = await createTestWorld(page, "Buchsatzprüfung");
  const current = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": `"${current.revision}"` },
    data: encodeManuscriptV1(book, current.revision),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  return world;
}

test("Print preview preserves editor position and shares physical pages with the PDF", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page);
  const editor = page.getByRole("textbox", { name: "Kapiteltext", exact: true });
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await page.locator(".editor-scroll").evaluate((element) => {
    element.scrollTop = 460;
  });
  const scrollTop = await page.locator(".editor-scroll").evaluate((element) => element.scrollTop);
  await page.getByRole("button", { name: "Druckansicht", exact: true }).click();
  const root = page.locator(".print-document");
  await expect(root).toHaveAttribute("data-book-ready", "true", { timeout: 60_000 });
  const sheets = root.locator(".pagedjs_page");
  const count = await sheets.count();
  expect(count).toBeGreaterThan(10);
  const chapterStarts = await root
    .locator('[data-chapter-start="true"]')
    .evaluateAll((elements) =>
      elements.map((element) => Number((element as HTMLElement).dataset.pageNumber)),
    );
  expect(chapterStarts).toHaveLength(3);
  expect(chapterStarts.every((number) => number % 2 === 1)).toBe(true);
  const originalText = await sheets.allTextContents();
  await page.getByRole("spinbutton", { name: "Zoom", exact: true }).fill("137");
  await page.getByRole("spinbutton", { name: "Zoom", exact: true }).press("Tab");
  await expect(sheets).toHaveCount(count);
  expect(await sheets.allTextContents()).toEqual(originalText);
  await page.getByRole("button", { name: "Ganze Seite", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("print-preview.png") });
  const previewText = await sheets.allTextContents();
  // A dedicated export view uses the same DOM renderer, without preview zoom or editor chrome.
  const renderPage = await page.context().newPage();
  await renderPage.goto(`${page.url()}&bookRender=1`);
  await expect(renderPage.locator(".print-document")).toHaveAttribute("data-book-ready", "true", {
    timeout: 60_000,
  });
  expect(await renderPage.locator(".pagedjs_page").allTextContents()).toEqual(previewText);
  const pdf = await renderPage.pdf({ preferCSSPageSize: true, printBackground: true });
  await testInfo.attach("book.pdf", { body: pdf, contentType: "application/pdf" });
  await renderPage.emulateMedia({ media: "print" });
  await testInfo.attach("print-geometry.json", {
    body: JSON.stringify(
      await renderPage
        .locator(
          "body, #root, .app-frame, .workspace, .text-workspace, .print-document, .pagedjs_pages, .pagedjs_page",
        )
        .evaluateAll((elements) =>
          elements.map((element) => ({
            selector: element.className || element.tagName,
            top: element.getBoundingClientRect().top,
            height: element.getBoundingClientRect().height,
            margin: getComputedStyle(element).margin,
            padding: getComputedStyle(element).padding,
            gap: getComputedStyle(element).gap,
          })),
        ),
    ),
    contentType: "application/json",
  });
  const pdfSource = pdf.toString("latin1");
  expect((pdfSource.match(/\/Type \/Page\b/g) || []).length).toBe(count);
  expect(pdfSource).toMatch(/\/MediaBox \[0 0 432(?:\.\d+)? 648(?:\.\d+)?\]/);
  await renderPage.close();
  await page.getByRole("button", { name: "Druckansicht", exact: true }).click();
  await expect(editor).toBeVisible();
  await expect
    .poll(() => page.locator(".editor-scroll").evaluate((element) => element.scrollTop))
    .toBeCloseTo(scrollTop, 0);
  await page.keyboard.type("@");
  await expect.poll(() => editor.textContent()).toContain("Star@tpunkt");
  expect(errors).toEqual([]);
});

test("Leaving Text from print preview preserves the editor session", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Editor session persistence is independent of viewport width.",
  );
  test.setTimeout(120_000);
  await seed(page);
  const editor = page.getByRole("textbox", { name: "Kapiteltext", exact: true });
  const scroller = page.locator(".editor-scroll");
  await editor.click();
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 4; index += 1) await page.keyboard.press("ArrowRight");
  const scrollTop = await scroller.evaluate((element) => {
    element.scrollTop = 460;
    element.dispatchEvent(new Event("scroll"));
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Druckansicht", exact: true }).click();
  await expect(page.locator(".print-document")).toHaveAttribute("data-book-ready", "true", {
    timeout: 60_000,
  });
  const binder = page.getByRole("complementary", { name: "Kapitel" });
  await binder.getByText("Das Versprechen", { exact: true }).click();

  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  await expect(page.getByLabel("Figuren und Beziehungen")).toBeVisible();
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();

  await expect(page.getByLabel("Kapiteltitel")).toHaveValue("Ankunft");
  await expect(editor).toBeFocused();
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(scrollTop);
  await page.keyboard.type("@");
  await expect.poll(() => editor.textContent()).toContain("Star@tpunkt");
});

test("Book settings survive reload and the PDF endpoint uses A5 pages", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "The export contract is independent of viewport width.",
  );
  test.setTimeout(120_000);
  const world = await seed(page, { ...manuscript, chapters: manuscript.chapters.slice(1) });
  await page.getByRole("button", { name: "Druckansicht", exact: true }).click();
  await expect(page.locator(".print-document")).toHaveAttribute("data-book-ready", "true", {
    timeout: 60_000,
  });
  await page.getByLabel("Seitenformat", { exact: true }).selectOption("a5");
  await expect(page.locator(".print-document")).toHaveAttribute("data-book-width-mm", "148");
  await expect(page.locator(".print-document")).toHaveAttribute("data-book-ready", "true", {
    timeout: 60_000,
  });
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/manuscript?world=${world.id}`)).json()).payload
          .bookLayout.pageFormat,
    )
    .toBe("a5");
  await page.reload();
  await page.getByRole("button", { name: "Druckansicht", exact: true }).click();
  await expect(page.getByLabel("Seitenformat", { exact: true })).toHaveValue("a5");
  await expect(page.locator(".print-document")).toHaveAttribute("data-book-ready", "true", {
    timeout: 60_000,
  });
  const count = await page.locator(".print-document .pagedjs_page").count();
  const response = await page.request.post("/api/book.pdf", {
    data: { worldId: world.id },
    timeout: 90_000,
  });
  expect(response.ok(), response.ok() ? "" : await response.text()).toBe(true);
  const pdf = await response.body();
  expect((pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length).toBe(count);
  const mediaBox = pdf.toString("latin1").match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  expect(mediaBox).not.toBeNull();
  // Chromium quantizes CSS millimetres to printer units, within one PDF point.
  expect(Math.abs(Number(mediaBox?.[1]) - (148 * 72) / 25.4)).toBeLessThan(1);
  expect(Math.abs(Number(mediaBox?.[2]) - (210 * 72) / 25.4)).toBeLessThan(1);
  await testInfo.attach("a5-book.pdf", { body: pdf, contentType: "application/pdf" });
});

test("Every bundled book font loads and preserves the manuscript text", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Font loading is independent of viewport width.");
  test.setTimeout(90_000);
  await seed(page, { ...manuscript, chapters: [manuscript.chapters[2]] });
  await page.getByRole("button", { name: "Druckansicht", exact: true }).click();
  const root = page.locator(".print-document");
  const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
  for (const [value, family] of [
    ["eb-garamond", "EB Garamond Variable"],
    ["literata", "Literata Variable"],
    ["source-serif-4", "Source Serif 4 Variable"],
    ["crimson-pro", "Crimson Pro Variable"],
    ["libre-baskerville", "Libre Baskerville"],
  ]) {
    await page.getByLabel("Schrift", { exact: true }).selectOption(value);
    await expect(root).toHaveAttribute("data-book-ready", "true", { timeout: 30_000 });
    await expect
      .poll(() =>
        root
          .locator(".book-paragraph")
          .first()
          .evaluate((p) => getComputedStyle(p).fontFamily),
      )
      .toContain(family);
    await expect(root).toHaveAttribute("data-book-ready", "true", { timeout: 30_000 });
    expect(
      await page.evaluate((name) => document.fonts.check(`12pt "${name}"`, "ÄÖÜäöüß"), family),
    ).toBe(true);
    expect(normalize((await root.locator(".book-paragraph").allTextContents()).join(" "))).toBe(
      normalize(manuscript.chapters[2].body),
    );
  }
});

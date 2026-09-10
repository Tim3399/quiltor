import type { Page } from "@playwright/test";
import { DEFAULT_BOOK_LAYOUT, type Manuscript } from "../../packages/client/src/modules/manuscript";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

const CHAPTER_COUNT = 100;
const PARAGRAPHS_PER_CHAPTER = 5;
const prose =
  "Am frühen Morgen lag der Hafen unter einer dünnen Nebelschicht. Mara ging langsam über die nassen Planken und hörte das Knarren der Taue zwischen den alten Speicherhäusern. Hinter den Fenstern erwachte die Stadt, während draußen auf dem Wasser ein einzelnes Licht den Weg zur Mole bezeichnete. Sie trug die gefaltete Karte dicht am Mantel und dachte an das Versprechen, das sie am Vorabend gegeben hatte. Noch wusste niemand, welche Nachricht im Archiv auf sie wartete, doch jeder Schritt führte sie näher an die verborgene Kammer unter dem Turm. Als die Glocke zur vollen Stunde schlug, blieb sie kurz stehen, prüfte die Zeichen am Rand des Papiers und setzte ihren Weg entschlossen fort.";

function normalizeParagraphText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const expectedParagraphs: string[] = [];
const chapters = Array.from({ length: CHAPTER_COUNT }, (_, chapterIndex) => {
  const number = chapterIndex + 1;
  const paragraphs = Array.from({ length: PARAGRAPHS_PER_CHAPTER }, (_, paragraphIndex) => {
    const identifier = `Absatzkennung K${String(number).padStart(3, "0")}-P${String(paragraphIndex + 1).padStart(2, "0")}.`;
    const paragraph = `${identifier} ${prose}`;
    expectedParagraphs.push(paragraph);
    return paragraph;
  });
  return {
    id: `chapter-${String(number).padStart(3, "0")}`,
    title: `Die Spur im Hafen ${number}`,
    note: "",
    body: paragraphs.join("\n\n"),
  };
});

const manuscript: Manuscript = {
  bookLayout: {
    ...DEFAULT_BOOK_LAYOUT,
    bookTitle: "Die hundert Karten",
    author: "Mara Beispiel",
    showDate: false,
    showVersion: false,
  },
  chapters,
};

async function seedLongManuscript(page: Page): Promise<string> {
  const world = await createTestWorld(page, `Langer Buchsatz ${crypto.randomUUID()}`);
  const currentResponse = await page.request.get(`/api/manuscript?world=${world.id}`);
  expect(currentResponse.ok(), await currentResponse.text()).toBe(true);
  const current = (await currentResponse.json()) as { revision: number };
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": `"${current.revision}"` },
    data: encodeManuscriptV1(manuscript, current.revision),
    timeout: 30_000,
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  return world.id;
}

test("Long book pagination preserves every paragraph and right-page chapter start", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Long pagination runs once at the wide viewport.");
  test.setTimeout(120_000);

  const worldId = await seedLongManuscript(page);
  const startedAt = performance.now();
  await page.goto(`/?world=${worldId}&bookRender=1`, { waitUntil: "domcontentloaded" });
  const root = page.locator(".print-document");
  await expect(root).toHaveAttribute("data-book-ready", "true", { timeout: 110_000 });
  const elapsedMs = Math.round(performance.now() - startedAt);

  const pages = root.locator(".pagedjs_page");
  const pageCount = await pages.count();
  expect(pageCount).toBeGreaterThan(200);

  const chapterStartPages = await root
    .locator('[data-chapter-start="true"]')
    .evaluateAll((elements) =>
      elements.map((element) => Number((element as HTMLElement).dataset.pageNumber)),
    );
  expect(chapterStartPages).toHaveLength(CHAPTER_COUNT);
  expect(chapterStartPages.every((number) => number % 2 === 1)).toBe(true);

  const renderedText = await root.locator(".book-paragraph").allTextContents();
  expect(normalizeParagraphText(renderedText.join(""))).toBe(
    normalizeParagraphText(expectedParagraphs.join("")),
  );
  for (let chapter = 1; chapter <= CHAPTER_COUNT; chapter += 1) {
    for (let paragraph = 1; paragraph <= PARAGRAPHS_PER_CHAPTER; paragraph += 1) {
      const identifier = `Absatzkennung K${String(chapter).padStart(3, "0")}-P${String(paragraph).padStart(2, "0")}.`;
      expect(renderedText.join("").split(identifier)).toHaveLength(2);
    }
  }

  await pages.evaluateAll((elements) => {
    (window as unknown as { __bookPaginationPages: Element[] }).__bookPaginationPages = [
      ...elements,
    ];
  });
  await root.evaluate((element) => {
    (element as HTMLElement).style.zoom = "1.1";
    window.scrollTo(0, Math.min(document.documentElement.scrollHeight, 1_000));
  });
  await page.waitForTimeout(100);
  const identitiesPreserved = await pages.evaluateAll((elements) => {
    const before = (window as unknown as { __bookPaginationPages?: Element[] })
      .__bookPaginationPages;
    return Boolean(
      before &&
        before.length === elements.length &&
        elements.every((element, index) => element === before[index]),
    );
  });
  expect(identitiesPreserved).toBe(true);

  await testInfo.attach("book-pagination-performance.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          chapters: CHAPTER_COUNT,
          sourceParagraphs: expectedParagraphs.length,
          pageCount,
          paginationElapsedMs: elapsedMs,
        },
        null,
        2,
      ),
      "utf8",
    ),
    contentType: "application/json",
  });
});

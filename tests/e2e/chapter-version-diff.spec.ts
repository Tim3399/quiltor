import type { Page } from "@playwright/test";
import type { Manuscript, TextMark } from "../../packages/client/src/modules/manuscript";
import { DOCUMENT_MEDIA_TYPE_V1 } from "../../packages/client/src/platform/contracts/v1/documentEnvelope";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import {
  decodeSavedManuscript,
  fulfillDocumentSave,
  fulfillManuscript,
  fulfillStoryWorld,
} from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

function record(text: string, marks: TextMark[] = []) {
  return { available: true, exists: true, text, marks };
}

type Comparison = { selected: ReturnType<typeof record>; previous: ReturnType<typeof record> };

async function openHistoryFixture(page: Page, comparisons: Record<string, Comparison>) {
  const initial: Manuscript = {
    chapters: [
      {
        id: "kapitel",
        title: "Aktuelles Kapitel",
        body: "Fabien wartet am Hafen.",
        note: "",
        marks: [{ from: 0, to: 6, kind: "bold" }],
        mentions: [
          {
            id: "erwaehnung",
            elementId: "fabien",
            from: 0,
            to: 6,
            surface: "Fabien",
            source: "helper",
            confidence: 1,
          },
        ],
      },
    ],
  };
  let manuscript = structuredClone(initial);
  const saves: Manuscript[] = [];
  await page.route("**/api/state*", (route) =>
    fulfillStoryWorld(route, {
      nodes: [{ id: "fabien", x: 100, y: 100, type: "person", name: "Fabien" }],
      edges: [],
    }),
  );
  await page.route("**/api/manuscript*", (route) => {
    if (route.request().method() === "GET")
      return fulfillManuscript(route, manuscript, saves.length);
    manuscript = decodeSavedManuscript<Manuscript>(route);
    saves.push(manuscript);
    return fulfillDocumentSave(route, saves.length);
  });
  await page.route("**/api/history*", (route) =>
    route.fulfill({
      json: {
        ok: true,
        commits: Object.keys(comparisons).map((hash) => ({
          hash,
          shortHash: hash,
          date: "10.09.2026 12:00",
          subject: `Fassung ${hash}`,
        })),
      },
    }),
  );
  await page.route("**/api/history/chapter-comparison*", (route) => {
    const ref = new URL(route.request().url()).searchParams.get("ref")!;
    return route.fulfill({ json: { ok: true, ...comparisons[ref] } });
  });
  const world = await createTestWorld(page, "Fassungsvergleich");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  return { initial, saves };
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: history is read-only and preserves the live manuscript`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript((selected) => localStorage.setItem("quiltor-theme", selected), theme);
    const { initial, saves } = await openHistoryFixture(page, {
      neu: {
        selected: record("Der junge Baum.\n\nEr wartete."),
        previous: record("Der alte Baum.\n\nEr wartete."),
      },
      alt: { selected: record("Frühere Fassung."), previous: record("") },
    });
    const editor = page.getByLabel("Kapiteltext");
    await expect(editor.locator(".text-bold")).toHaveText("Fabien");
    await expect(editor.locator(".entity-mention")).toHaveText("Fabien");
    await page.getByRole("button", { name: "Fassungen", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Fassungen" });
    await expect(editor.locator(".version-diff-added")).toHaveText("junge");
    await expect(editor.locator(".version-diff-removed")).toHaveText("alte");
    await expect(editor).toHaveAttribute("aria-readonly", "true");
    await expect(editor.locator(".entity-mention")).toHaveCount(0);
    await expect(panel).not.toContainText("Der junge Baum");
    await page.screenshot({
      path: testInfo.outputPath(`inline-history-${theme}.png`),
      fullPage: true,
    });

    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    const copied = await editor.evaluate((element) => {
      const clipboardData = new DataTransfer();
      element.dispatchEvent(
        new ClipboardEvent("copy", { clipboardData, bubbles: true, cancelable: true }),
      );
      return clipboardData.getData("text/plain");
    });
    expect(copied).toBe("Der junge Baum.\n\nEr wartete.");
    await page.keyboard.type("Unerlaubte Änderung");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("Tab");
    await expect(editor.locator(".version-diff-added")).toHaveText("junge");

    await panel.getByRole("combobox").selectOption("alt");
    await expect(editor).toContainText("Frühere Fassung.");
    await expect(editor.locator(".version-diff-removed")).toHaveCount(0);
    await panel.getByRole("button", { name: "Kapitelfassungen schließen" }).click();
    await expect(editor).toHaveText(initial.chapters[0].body);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(editor.locator(".text-bold")).toHaveText("Fabien");
    await expect(editor.locator(".entity-mention")).toHaveText("Fabien");
    expect(saves).toEqual([]);

    const write = page.waitForResponse(
      (response) =>
        response.url().includes("/api/manuscript") && response.request().method() === "PUT",
    );
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Weiter.");
    await write;
    expect(saves).toHaveLength(1);
    expect(saves[0].chapters[0]).toMatchObject({
      body: `${initial.chapters[0].body} Weiter.`,
      marks: initial.chapters[0].marks,
      mentions: initial.chapters[0].mentions,
    });
  });
}

test("Formatting-only revisions have no text additions or deletions", async ({
  page,
}, testInfo) => {
  const text = "Der stille Hafen.";
  const italic: TextMark[] = [{ from: 4, to: 10, kind: "italic" }];
  await openHistoryFixture(page, {
    kursiv: { selected: record(text, italic), previous: record(text) },
    normal: { selected: record(text), previous: record(text, italic) },
  });
  await page.getByRole("button", { name: "Fassungen", exact: true }).click();
  const editor = page.getByLabel("Kapiteltext");
  const panel = page.getByRole("complementary", { name: "Fassungen" });
  await expect(editor.locator(".version-diff-format-added")).toHaveText("stille");
  await expect(editor.locator(".text-italic")).toHaveText("stille");
  await expect(editor.locator(".version-diff-added, .version-diff-removed")).toHaveCount(0);
  await expect(editor).toHaveText(text);
  await page.screenshot({ path: testInfo.outputPath("formatting-history.png"), fullPage: true });
  await panel.getByRole("combobox").selectOption("normal");
  await expect(editor.locator(".version-diff-format-removed")).toHaveText("stille");
  await expect(editor.locator(".text-italic")).toHaveCount(0);
  await expect(editor.locator(".version-diff-added, .version-diff-removed")).toHaveCount(0);
  await expect(editor).toHaveText(text);
});

test("Viewing revisions leaves the live undo and redo history intact", async ({ page }) => {
  const { initial, saves } = await openHistoryFixture(page, {
    alt: { selected: record("Die frühere Fassung."), previous: record("Die erste Fassung.") },
  });
  const editor = page.getByLabel("Kapiteltext");
  await editor.fill("Die aktuelle Bearbeitung.");
  await expect.poll(() => saves.length).toBe(1);
  await page.getByRole("button", { name: "Fassungen", exact: true }).click();
  await expect(editor.locator(".version-diff-added")).toHaveText("frühere");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.getByRole("button", { name: "Kapitelfassungen schließen" }).click();
  await expect(editor).toHaveText("Die aktuelle Bearbeitung.");
  expect(saves).toHaveLength(1);
  await editor.click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(editor).toHaveText(initial.chapters[0].body);
  await expect(editor.locator(".text-bold")).toHaveText("Fabien");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(editor).toHaveText("Die aktuelle Bearbeitung.");
});

test("Paragraph changes stay local and loading keeps the current text visible", async ({
  page,
}) => {
  const previous = "Er ging. Dann wartete er. Der Hafen blieb still.";
  const selected = "Er ging.\n\nDann wartete er. Der Hafen blieb still.";
  await openHistoryFixture(page, {
    absatz: { selected: record(selected), previous: record(previous) },
    zusammen: { selected: record(previous), previous: record(selected) },
  });
  let release: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/history/chapter-comparison*", async (route) => {
    await ready;
    await route.fallback();
  });
  const editor = page.getByLabel("Kapiteltext");
  const requested = page.waitForRequest("**/api/history/chapter-comparison*");
  await page.getByRole("button", { name: "Fassungen", exact: true }).click();
  await requested;
  await expect(editor).toHaveText("Fabien wartet am Hafen.");
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  release();
  await expect(editor.locator(".cm-line")).toHaveCount(3);
  await expect(editor).toContainText("Dann wartete er. Der Hafen blieb still.");
  expect((await editor.locator(".version-diff-added").allTextContents()).join("")).not.toContain(
    "Hafen",
  );
  const panel = page.getByRole("complementary", { name: "Fassungen" });
  await panel.getByRole("combobox").selectOption("zusammen");
  await expect(editor.locator(".version-diff-removed")).toBeVisible();
  await expect(editor.locator(".version-diff-removed")).not.toContainText("Hafen");
  await expect(editor).toContainText("Dann wartete er. Der Hafen blieb still.");
});

test("Unavailable predecessors and empty or missing chapters do not show stale changes", async ({
  page,
}) => {
  await openHistoryFixture(page, {
    ohne: {
      selected: record("Ein lesbarer historischer Text."),
      previous: { ...record(""), available: false, exists: false },
    },
    leer: { selected: record(""), previous: record("") },
    fehlt: { selected: { ...record(""), exists: false }, previous: record("") },
  });
  await page.getByRole("button", { name: "Fassungen", exact: true }).click();
  const editor = page.getByLabel("Kapiteltext");
  const panel = page.getByRole("complementary", { name: "Fassungen" });
  await expect(editor).toHaveText("Ein lesbarer historischer Text.");
  await expect(editor.locator(".version-diff-added, .version-diff-removed")).toHaveCount(0);
  await panel.getByRole("combobox").selectOption("leer");
  await expect(editor.locator(".cm-line")).toHaveText("");
  await panel.getByRole("combobox").selectOption("fehlt");
  await expect(panel).toContainText("existierte");
  await expect(editor.locator(".cm-line")).toHaveText("");
  await expect(editor).toHaveAttribute("aria-readonly", "true");
});

test("Real snapshots carry formatting from SQLite through the API into the editor", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "The persistence round trip only needs one viewport.",
  );
  const world = await createTestWorld(page, "Historische Formatierung");
  const body = "Séraphine sah zum Hafen.";
  const marks: TextMark[] = [{ from: 0, to: 9, kind: "italic" }];
  const url = `/api/manuscript?world=${world.id}`;
  const save = async (text: string, formatting: TextMark[]) => {
    const current = await page.request.get(url);
    expect(current.ok()).toBe(true);
    const revision = Number(current.headers().etag.replaceAll('"', ""));
    const saved = await page.request.put(url, {
      headers: {
        Accept: DOCUMENT_MEDIA_TYPE_V1,
        "Content-Type": "application/json",
        "If-Match": `"${revision}"`,
      },
      data: encodeManuscriptV1(
        {
          chapters: [{ id: "kapitel", title: "Am Hafen", body: text, note: "", marks: formatting }],
        },
        revision,
      ),
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  };
  const snapshot = async (message: string) => {
    const saved = await page.request.post("/api/backup", {
      data: { worldId: world.id, message, push: false },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  };
  await save(body, []);
  await snapshot("Ohne Hervorhebung");
  await save(body, marks);
  await snapshot("Mit Hervorhebung");
  await save("Die aktuelle Arbeitsfassung.", []);
  const comparison = await page.request.get(
    `/api/history/chapter-comparison?world=${world.id}&ref=HEAD&chapterId=kapitel`,
  );
  expect(comparison.ok()).toBe(true);
  expect(await comparison.json()).toMatchObject({
    selected: record(body, marks),
    previous: record(body),
  });
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Fassungen", exact: true }).click();
  const editor = page.getByLabel("Kapiteltext");
  await expect(editor).toHaveText(body);
  await expect(editor.locator(".text-italic")).toHaveText("Séraphine");
  await expect(editor.locator(".version-diff-format-added")).toHaveText("Séraphine");
  await expect(editor.locator(".version-diff-added, .version-diff-removed")).toHaveCount(0);
  await page.getByRole("button", { name: "Kapitelfassungen schließen" }).click();
  await expect(editor).toHaveText("Die aktuelle Arbeitsfassung.");
});

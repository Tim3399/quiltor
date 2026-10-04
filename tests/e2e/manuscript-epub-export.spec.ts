import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { DEFAULT_BOOK_LAYOUT, type Manuscript } from "../../packages/client/src/modules/manuscript";
import { encodeManuscriptV1 } from "../../packages/client/src/platform/contracts/v1/manuscript";
import { createTestWorld, expect, test } from "./support/world-fixture";

const run = promisify(execFile);

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
        { from: 3, to: 13, kind: "bold" },
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
    folders: [
      { id: "part", title: "Erster Teil" },
      { id: "section", title: "Hafen" },
    ],
    items: [
      { id: "part-item", kind: "folder", folderId: "part", position: 0 },
      {
        id: "section-item",
        kind: "folder",
        folderId: "section",
        parentFolderId: "part",
        position: 0,
      },
      {
        id: "first-item",
        kind: "chapter",
        chapterId: "first",
        parentFolderId: "section",
        position: 0,
      },
      {
        id: "second-item",
        kind: "chapter",
        chapterId: "second",
        parentFolderId: "section",
        position: 1,
      },
      { id: "aside-item", kind: "chapter", chapterId: "aside", position: 1 },
    ],
  },
  bookLayout: {
    ...DEFAULT_BOOK_LAYOUT,
    bookTitle: "Die Küste & das Meer",
    author: "Zoë Beispiel",
  },
  language: "de-DE",
};

type EpubInspection = {
  mimetype: string;
  title: string;
  author: string;
  language: string;
  navigation: string[];
  chapterText: string[];
  strong: number;
  emphasis: number;
};

const inspectEpubScript = `
import json, sys, zipfile
from xml.etree import ElementTree as ET

XHTML = "{http://www.w3.org/1999/xhtml}"
DC = "{http://purl.org/dc/elements/1.1/}"
with zipfile.ZipFile(sys.argv[1]) as archive:
    package = ET.fromstring(archive.read("EPUB/package.opf"))
    nav = ET.fromstring(archive.read("EPUB/nav.xhtml"))
    chapters = [ET.fromstring(archive.read(f"EPUB/chapter-{index:05}.xhtml")) for index in (1, 2)]
    print(json.dumps({
        "mimetype": archive.read("mimetype").decode("ascii"),
        "title": package.findtext(f".//{DC}title"),
        "author": package.findtext(f".//{DC}creator"),
        "language": package.findtext(f".//{DC}language"),
        "navigation": [link.text for link in nav.findall(f".//{XHTML}a")],
        "chapterText": [" ".join("".join(chapter.itertext()).split()) for chapter in chapters],
        "strong": sum(len(chapter.findall(f".//{XHTML}strong")) for chapter in chapters),
        "emphasis": sum(len(chapter.findall(f".//{XHTML}em")) for chapter in chapters),
    }))
`;

async function inspectEpub(path: string): Promise<EpubInspection> {
  const launcher = process.platform === "win32" ? "py" : "python";
  const launcherArguments = process.platform === "win32" ? ["-3.12"] : [];
  const { stdout } = await run(launcher, [...launcherArguments, "-c", inspectEpubScript, path], {
    encoding: "utf8",
  });
  return JSON.parse(stdout) as EpubInspection;
}

async function seed(page: Page, model: Manuscript = manuscript) {
  const world = await createTestWorld(page, "EPUB-Exportprüfung");
  const current = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, {
    headers: { "If-Match": `"${current.revision}"` },
    data: encodeManuscriptV1(model, current.revision),
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  return world;
}

async function openEpubExport(page: Page) {
  await page.getByRole("button", { name: "Buch exportieren", exact: true }).click();
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/manuscript-export/preview"),
  );
  await page.getByRole("menuitem", { name: "EPUB für E-Reader", exact: true }).click();
  const previewResponse = await response;
  expect(previewResponse.ok(), await previewResponse.text()).toBe(true);
  const dialog = page.getByRole("dialog", { name: "EPUB-Inhalt prüfen", exact: true });
  await expect(dialog.getByRole("heading", { name: "1. Ankunft", exact: true })).toBeVisible();
  return { dialog, preview: (await previewResponse.json()).preview };
}

for (const theme of ["light", "dark"] as const) {
  test(`EPUB reviews and downloads the ordered book in ${theme} mode`, async ({
    page,
  }, testInfo) => {
    test.skip(
      !["wide", "compact"].includes(testInfo.project.name),
      "EPUB visual and interaction coverage uses desktop and compact layouts.",
    );
    await page.addInitScript((value) => localStorage.setItem("quiltor-theme", value), theme);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const world = await seed(page);
    const before = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
    const { dialog, preview } = await openEpubExport(page);

    expect(preview.preset).toBe("epub");
    expect(preview.fileName).toBe("Quiltor-Manuskript.epub");
    expect(preview.chapters.map((chapter: { id: string }) => chapter.id)).toEqual([
      "first",
      "second",
    ]);
    expect(preview.metadata).toEqual({
      title: "Die Küste & das Meer",
      author: "Zoë Beispiel",
      language: "de-DE",
    });
    await expect(dialog.getByText("Die Küste & das Meer", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Zoë Beispiel", { exact: true })).toBeVisible();
    await expect(dialog.getByText("de-DE", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Private Planung", { exact: true })).toHaveCount(0);
    await expect(
      dialog.getByText("Nicht enthaltene Kapitelnotizen: 1", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Nicht im Buch enthaltene Kapitel: 1", { exact: true }),
    ).toBeVisible();

    const downloadButton = dialog.getByRole("button", {
      name: "EPUB herunterladen",
      exact: true,
    });
    await expect(downloadButton).toBeDisabled();
    const accessibility = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`epub-export-${theme}-${testInfo.project.name}.png`),
    });

    await dialog
      .getByRole("checkbox", { name: "Alle angezeigten Hinweise wurden geprüft" })
      .check();
    const downloadRequest = page.waitForRequest((candidate) =>
      candidate.url().includes("/api/manuscript-export/epub"),
    );
    const downloadResponse = page.waitForResponse((candidate) =>
      candidate.url().includes("/api/manuscript-export/epub"),
    );
    const downloadEvent = page.waitForEvent("download");
    await downloadButton.click();
    const request = await downloadRequest;
    expect(request.postDataJSON()).toEqual({
      preset: "epub",
      revision: preview.revision,
      sourceSha256: preview.sourceSha256,
      acknowledgedWarnings: preview.warnings.map(({ code }: { code: string }) => code),
    });
    const response = await downloadResponse;
    expect(response.ok(), await response.text()).toBe(true);
    expect(response.headers()["content-type"]).toBe("application/epub+zip");

    const downloaded = await downloadEvent;
    expect(downloaded.suggestedFilename()).toBe("Quiltor-Manuskript.epub");
    const downloadPath = testInfo.outputPath(downloaded.suggestedFilename());
    await downloaded.saveAs(downloadPath);
    const bytes = await readFile(downloadPath);
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    const inspected = await inspectEpub(downloadPath);
    expect(inspected).toMatchObject({
      mimetype: "application/epub+zip",
      title: "Die Küste & das Meer",
      author: "Zoë Beispiel",
      language: "de-DE",
      navigation: ["1. Ankunft", "2. Aufbruch"],
    });
    expect(inspected.chapterText[0]).toContain("😀 Der Morgen lag still.");
    expect(inspected.chapterText[1]).toContain("Sie ging an Bord.");
    expect(inspected.strong).toBeGreaterThan(0);
    expect(inspected.emphasis).toBeGreaterThan(0);

    const after = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
    expect(after).toEqual(before);
    expect(errors).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Buch exportieren", exact: true })).toBeFocused();
  });
}

test("EPUB defaults metadata and rejects a stale metadata review", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The metadata conflict is covered once.");
  const defaults: Manuscript = {
    ...manuscript,
    bookLayout: undefined,
    language: undefined,
  };
  const world = await seed(page, defaults);
  const persisted = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  // The repository materializes its default language when a manuscript omits the field.
  expect(persisted.payload.language).toBe("de-DE");
  const { dialog, preview } = await openEpubExport(page);
  expect(preview.metadata).toEqual({
    title: "Manuskript",
    author: "",
    language: persisted.payload.language,
  });
  await expect(dialog.getByText("Nicht angegeben", { exact: true })).toBeVisible();

  const current = await (await page.request.get(`/api/manuscript?world=${world.id}`)).json();
  current.payload.bookLayout = {
    ...DEFAULT_BOOK_LAYOUT,
    bookTitle: "Geänderter Titel",
    author: "Neue Autorin",
  };
  const saved = await page.request.put(`/api/manuscript?world=${world.id}`, { data: current });
  expect(saved.ok(), await saved.text()).toBe(true);
  await dialog.getByRole("checkbox", { name: "Alle angezeigten Hinweise wurden geprüft" }).check();
  const rejected = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/manuscript-export/epub"),
  );
  await dialog.getByRole("button", { name: "EPUB herunterladen", exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(dialog.getByRole("alert")).toContainText(
    "Das Manuskript hat sich seit der Vorschau geändert",
  );
  await expect(
    dialog.getByRole("button", { name: "EPUB herunterladen", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Vorschau neu laden", exact: true }).click();
  await expect(dialog.getByText("Geänderter Titel", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Neue Autorin", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
});

test("EPUB review reflows with doubled text at 320 pixels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The explicit 320-pixel viewport is covered once.");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, {
    ...manuscript,
    bookLayout: {
      ...DEFAULT_BOOK_LAYOUT,
      bookTitle: "TitelOhneTrennstelle".repeat(24),
      author: "AutorOhneTrennstelle".repeat(24),
    },
  });
  const { dialog } = await openEpubExport(page);
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
      ...root.querySelectorAll<HTMLElement>(
        ".dialog-content, .manuscript-export-dialog, .manuscript-export-metadata, button",
      ),
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
    dialog.getByRole("button", { name: "EPUB herunterladen", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("epub-export-reflow.png") });
  for (let index = 0; index < 15; index += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((root) => root.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

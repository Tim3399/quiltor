import type { Page, Request } from "@playwright/test";
import { createTestWorld, expect, registerTestWorld, test } from "./support/world-fixture";

/*
 * The example world opens as a preview (T-214-5b, D-127). It is not a world of the author's
 * until they change something: it stays out of the list, a bar says what it is, and leaving
 * it unchanged leaves nothing behind. The first saved change makes it a real world -- marked
 * for good and listed after the author's own. The server decides all of this; these tests
 * watch what the page sends and shows.
 */

const TITLE_DE = "Der gläserne Atlas";
const TITLE_EN = "The Glass Atlas";
const PREVIEW_BAR = "Beispielwelt – sobald du etwas änderst, wird sie zu deiner Welt.";
const OPEN_EXAMPLE = "open-example";
const DOCUMENT_WRITE = /\/api\/(manuscript|state|storyboards)(\?|$)/;

function documentWrites(page: Page): Request[] {
  const writes: Request[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET" && DOCUMENT_WRITE.test(request.url())) writes.push(request);
  });
  return writes;
}

async function openExampleFromHelp(page: Page): Promise<string> {
  const opened = page.waitForResponse(
    (response) => response.url().endsWith(OPEN_EXAMPLE) && response.ok(),
  );
  await page.getByRole("button", { name: "Hilfe", exact: true }).click();
  await page.getByRole("menuitem", { name: "Beispielwelt öffnen" }).click();
  const world = (await (await opened).json()).world as { id: string; preview: boolean };
  expect(world.preview).toBe(true);
  registerTestWorld(page, world.id);
  await expect(page.getByRole("status").filter({ hasText: PREVIEW_BAR })).toBeVisible();
  return world.id;
}

async function listedIds(page: Page): Promise<string[]> {
  const listed = await page.request.get("/api/worlds");
  return ((await listed.json()).worlds as { id: string }[]).map((world) => world.id);
}

async function typeIntoFirstChapter(page: Page) {
  const saved = page.waitForResponse(
    (response) =>
      DOCUMENT_WRITE.test(response.url()) && response.request().method() !== "GET" && response.ok(),
  );
  const editor = page.getByRole("textbox", { name: "Kapiteltext" });
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Ein neuer Satz.");
  return saved;
}

test.describe("example world preview", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("quiltor-interface-language", "de");
    });
  });

  test("opening it sends no document write and keeps it out of the list", async ({ page }) => {
    const writes = documentWrites(page);
    await page.goto("/");
    const id = await openExampleFromHelp(page);
    await expect(page.getByRole("textbox", { name: "Kapiteltext" })).toBeVisible();
    // Long enough for any autosave debounce to have fired.
    await page.waitForTimeout(3_000);
    expect(writes.map((request) => `${request.method()} ${request.url()}`)).toEqual([]);
    expect(await listedIds(page)).not.toContain(id);
  });

  test("opened again by its link, it is still a preview with its bar", async ({ page }) => {
    await page.goto("/");
    const id = await openExampleFromHelp(page);
    // A second tab: leaving the first one would discard the preview (see below).
    const second = await page.context().newPage();
    await second.goto(`/?world=${id}`);
    await expect(second.getByRole("status").filter({ hasText: PREVIEW_BAR })).toBeVisible();
    expect(await listedIds(page)).not.toContain(id);
    await second.close();
  });

  test("closing or reloading the page discards an unchanged preview", async ({ page }) => {
    await page.goto("/");
    const id = await openExampleFromHelp(page);
    const discarded = page.waitForRequest((request) =>
      request.url().endsWith("/api/worlds/discard-preview"),
    );
    await page.reload();
    const request = await discarded;
    expect(request.headers()["content-type"]).toBe("application/json");
    await expect
      .poll(async () => (await page.request.get(`/api/manuscript?world=${id}`)).status())
      .toBe(404);
  });

  test("the first saved change makes it a real world and the bar goes", async ({ page }) => {
    await page.goto("/");
    const id = await openExampleFromHelp(page);
    const saved = await typeIntoFirstChapter(page);
    expect((await saved.json()).world).toMatchObject({ id, origin: "example" });
    await expect(page.getByRole("status").filter({ hasText: PREVIEW_BAR })).toHaveCount(0);
    expect(await listedIds(page)).toContain(id);
  });

  test("a preview offers no versions or sync until its first change", async ({ page }) => {
    await page.goto("/");
    await openExampleFromHelp(page);
    const more = page.getByRole("button", { name: "Mehr" });
    const versions = page.getByRole("menuitem", { name: "Versionen & Sicherungen" });
    await more.click();
    await expect(page.getByRole("menuitem", { name: "Zur Weltauswahl" })).toBeVisible();
    await expect(versions).toHaveCount(0);
    await page.keyboard.press("Escape");
    await (await typeIntoFirstChapter(page)).finished();
    await expect(page.getByRole("status").filter({ hasText: PREVIEW_BAR })).toHaveCount(0);
    await more.click();
    await expect(versions).toBeVisible();
  });

  test("the palette offers no versions in a preview, but after the first change", async ({
    page,
  }) => {
    const entries = page.getByRole("option", {
      name: /Versionen öffnen|Version festhalten|Automatische Sicherungen öffnen/,
    });
    const openPalette = async () => {
      await page.getByRole("button", { name: "Suche öffnen" }).click();
      await expect(page.getByRole("option").first()).toBeVisible();
    };
    await page.goto("/");
    await openExampleFromHelp(page);
    await openPalette();
    await expect(entries).toHaveCount(0);
    await page.keyboard.press("Escape");
    await (await typeIntoFirstChapter(page)).finished();
    await expect(page.getByRole("status").filter({ hasText: PREVIEW_BAR })).toHaveCount(0);
    await openPalette();
    await expect(entries).toHaveCount(3);
  });

  test("leaving it unchanged discards it", async ({ page }) => {
    await page.goto("/");
    const id = await openExampleFromHelp(page);
    const discarded = page.waitForResponse((response) =>
      response.url().endsWith("/api/worlds/discard-preview"),
    );
    await page.getByRole("button", { name: "Mehr" }).click();
    await page.getByRole("menuitem", { name: "Zur Weltauswahl" }).click();
    expect((await discarded).status()).toBe(200);
    const gone = await page.request.get(`/api/manuscript?world=${id}`);
    expect(gone.status()).toBe(404);
  });

  test("a second one gets a number, is marked and comes after the author's own", async ({
    page,
  }) => {
    const ownWorld = await createTestWorld(page, TITLE_DE);
    await page.goto("/");
    const id = await openExampleFromHelp(page);
    const saved = await typeIntoFirstChapter(page);
    const title = (await saved.json()).world.title as string;
    expect(title).toMatch(new RegExp(`^${TITLE_DE} \\(\\d+\\)$`));

    await page.getByRole("button", { name: "Mehr" }).click();
    await page.getByRole("menuitem", { name: "Zur Weltauswahl" }).click();
    const example = page.getByRole("button", { name: `${title} – Beispielwelt – Welt öffnen` });
    await expect(example).toBeVisible();
    await expect(example).toContainText("Beispielwelt ·");
    const card = example.locator("xpath=ancestor::*[contains(@class,'selection-card')][1]");
    await expect(card).toHaveCSS("border-top-style", "dashed");
    const ids = await listedIds(page);
    expect(ids.indexOf(id)).toBeGreaterThan(ids.indexOf(ownWorld.id));
  });

  test("the empty world list offers the example world as a button", async ({ page }) => {
    await page.route("**/api/worlds", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { ok: true, worlds: [] } })
        : route.fallback(),
    );
    await page.goto("/");
    await expect(page.getByText("Noch keine Welt vorhanden.")).toBeVisible();
    const opened = page.waitForResponse((response) => response.url().endsWith(OPEN_EXAMPLE));
    await page.getByRole("button", { name: "Beispielwelt öffnen" }).click();
    const world = (await (await opened).json()).world as { id: string };
    registerTestWorld(page, world.id);
    await expect(page.getByRole("status").filter({ hasText: PREVIEW_BAR })).toBeVisible();
  });

  test("the interface language picks the world", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("quiltor-interface-language", "en");
    });
    await page.goto("/");
    const opened = page.waitForResponse((response) => response.url().endsWith(OPEN_EXAMPLE));
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("menuitem", { name: "Open the example world" }).click();
    const world = (await (await opened).json()).world as { id: string; title: string };
    registerTestWorld(page, world.id);
    expect(world.title).toBe(TITLE_EN);
  });
});

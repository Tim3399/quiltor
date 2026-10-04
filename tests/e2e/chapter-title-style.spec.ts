import type { Page } from "@playwright/test";
import {
  decodeSavedManuscript,
  fulfillDocumentSave,
  fulfillManuscript,
} from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

async function openChapter(page: Page, initialTitle = "Prolog") {
  let manuscript = {
    chapters: [{ id: "chapter-title-style", title: initialTitle, body: "Nebel.", note: "" }],
  };
  let revision = 0;
  await page.route("**/api/manuscript*", (route) => {
    if (route.request().method() === "GET") {
      return fulfillManuscript(route, manuscript, revision);
    }
    manuscript = decodeSavedManuscript<typeof manuscript>(route);
    revision += 1;
    return fulfillDocumentSave(route, revision);
  });
  const world = await createTestWorld(page, "Kapiteltitel-Stiltest");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("textbox", { name: "Kapiteltitel" }).waitFor();
  return () => manuscript;
}

function channel(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(first: string, second: string) {
  const parse = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (channels?.length !== 3) throw new Error(`Invalid RGB color: ${color}`);
    return (
      0.2126 * channel(channels[0]) + 0.7152 * channel(channels[1]) + 0.0722 * channel(channels[2])
    );
  };
  const [lighter, darker] = [parse(first), parse(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("The chapter title stays document-like and keeps a clear keyboard focus", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "The CSS contract is viewport-independent.");
  await openChapter(page);

  const title = page.getByRole("textbox", { name: "Kapiteltitel" });
  const style = () =>
    title.evaluate((input) => {
      const computed = getComputedStyle(input);
      let surface: Element | null = input.parentElement;
      let surfaceColor = "rgba(0, 0, 0, 0)";
      while (surface) {
        surfaceColor = getComputedStyle(surface).backgroundColor;
        if (surfaceColor !== "rgba(0, 0, 0, 0)") break;
        surface = surface.parentElement;
      }
      return {
        background: computed.backgroundColor,
        borderBottomColor: computed.borderBottomColor,
        borderBottomWidth: computed.borderBottomWidth,
        borderLeftWidth: computed.borderLeftWidth,
        borderRightWidth: computed.borderRightWidth,
        borderTopWidth: computed.borderTopWidth,
        borderRadius: computed.borderRadius,
        boxShadow: computed.boxShadow,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
        paddingTop: computed.paddingTop,
        surfaceColor,
      };
    });

  await page.mouse.move(0, 0);
  const idle = await style();
  expect(idle).toMatchObject({
    background: "rgba(0, 0, 0, 0)",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderLeftWidth: "0px",
    borderBottomWidth: "1px",
    borderRadius: "0px",
    boxShadow: "none",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingLeft: "0px",
  });

  await title.hover();
  await expect.poll(async () => (await style()).borderBottomColor).not.toBe("rgba(0, 0, 0, 0)");
  const hovered = await style();
  expect(hovered.boxShadow).toBe("none");

  await title.focus();
  await page.mouse.move(0, 0);
  await expect
    .poll(async () => {
      const current = await style();
      return contrastRatio(current.borderBottomColor, current.surfaceColor);
    })
    .toBeGreaterThanOrEqual(3);
  const focused = await style();
  expect(focused.background).toBe(idle.background);
  expect(focused.borderTopWidth).toBe("0px");
  expect(focused.borderRightWidth).toBe("0px");
  expect(focused.borderLeftWidth).toBe("0px");
  expect(focused.boxShadow).not.toBe("none");
});

test("A long chapter title remains readable and single-line in compact editing", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "compact", "This regression covers compact title reflow.");
  const initialTitle =
    "Die Ankunft im Gezeitenarchiv KapitelOhneTrennzeichenDasAuchAufSchmalenBildschirmenVollstaendigLesbarBleibt";
  const savedManuscript = await openChapter(page, initialTitle);
  const title = page.getByRole("textbox", { name: "Kapiteltitel" });

  const layout = await title.evaluate((element) => {
    const field = element as HTMLTextAreaElement;
    const lineHeight = Number.parseFloat(getComputedStyle(field).lineHeight);
    return {
      height: field.getBoundingClientRect().height,
      lineHeight,
      clientWidth: field.clientWidth,
      scrollWidth: field.scrollWidth,
      clientHeight: field.clientHeight,
      scrollHeight: field.scrollHeight,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.height).toBeGreaterThan(layout.lineHeight * 1.5);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight + 1);
  expect(layout.documentScrollWidth).toBe(layout.documentClientWidth);

  await title.focus();
  await title.evaluate((field) => {
    const end = (field as HTMLTextAreaElement).value.length;
    (field as HTMLTextAreaElement).setSelectionRange(end, end);
  });
  await page.keyboard.insertText(" – Schluss");
  const editedTitle = `${initialTitle} – Schluss`;
  await page.keyboard.press("Enter");
  await expect(title).toHaveValue(editedTitle);
  await expect.poll(() => savedManuscript().chapters[0]?.title).toBe(editedTitle);

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Kapiteltitel" })).toHaveValue(editedTitle);
});

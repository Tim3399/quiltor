import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { fulfillDocumentSave, fulfillManuscript } from "./support/application-api";

async function openChapter(page: Page) {
  await page.route("**/api/manuscript*", (route) =>
    route.request().method() === "GET"
      ? fulfillManuscript(route, {
          chapters: [{ id: "chapter-title-style", title: "Prolog", body: "Nebel.", note: "" }],
        })
      : fulfillDocumentSave(route, 1),
  );
  const response = await page.request.post("/api/worlds/create", {
    data: { title: "Kapiteltitel-Stiltest", backupUrl: "" },
  });
  const payload = await response.json();
  await page.goto(`/?world=${payload.world.id}`);
  await page.getByRole("textbox", { name: "Kapiteltitel" }).waitFor();
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
    if (channels?.length !== 3) throw new Error(`Ungültige RGB-Farbe: ${color}`);
    return (
      0.2126 * channel(channels[0]) + 0.7152 * channel(channels[1]) + 0.0722 * channel(channels[2])
    );
  };
  const [lighter, darker] = [parse(first), parse(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

test("Kapiteltitel bleibt dokumentartig und behält einen klaren Tastaturfokus", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Der CSS-Vertrag ist viewport-unabhängig.");
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

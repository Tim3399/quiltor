import type { Page } from "@playwright/test";
import type { FigureState } from "../../packages/client/src/modules/story-world";
import { mockRequiredWorldDocuments } from "./support/application-api";
import { createTestWorld, expect, test } from "./support/world-fixture";

const storyWorld: FigureState = {
  nodes: [
    {
      id: "mara",
      x: 120,
      y: 120,
      type: "person",
      name: "Mara Venn",
      label: "Kartographin",
      sub: "Liest lebende Karten.",
    },
  ],
  edges: [],
  timeline: [{ id: "arrival", title: "Ankunft", time: 0, position: 0 }],
  presence: [],
  timeSystem: {
    id: "primary",
    name: "Gregorianisch",
    kind: "gregorian",
    unit: "day",
    eraName: "",
    eraAbbreviation: "",
    epochTime: 0,
    epochYear: 2024,
    epochMonth: 1,
    epochDay: 1,
    epochWeekday: 0,
    displayFormat: "",
    months: [],
    weekdays: [],
  },
};

async function openWorld(page: Page) {
  await mockRequiredWorldDocuments(page, {
    manuscript: {
      chapters: [{ id: "chapter", title: "Prolog", body: "Nebel.", note: "" }],
    },
    storyWorld,
  });
  const world = await createTestWorld(page, "Kontrollkonsistenz");
  await page.goto(`/?world=${world.id}`);
  await page.getByRole("textbox", { name: "Kapiteltitel" }).waitFor();
}

async function visualState(page: Page, accessibleName: string) {
  return page.getByRole("button", { name: accessibleName }).evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      color: style.color,
    };
  });
}

test("priority and timeline controls keep visible states and usable targets", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name === "regular",
    "Wide and compact cover regular and touch targets.",
  );
  await openWorld(page);
  const expectedHeight = testInfo.project.name === "compact" ? 44 : 36;

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((value) => localStorage.setItem("quiltor-theme", value), theme);
    await page.reload();

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    await page.locator(".story-node", { hasText: "Mara Venn" }).dispatchEvent("click");
    const priority = page.getByRole("button", { name: "Als wichtig markieren" });
    await expect(priority).toHaveAttribute("aria-pressed", "false");
    await priority.evaluate(async (button) => {
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
    const inactive = await visualState(page, "Als wichtig markieren");
    await priority.focus();
    await page.keyboard.press("Space");
    const active = page.getByRole("button", { name: "Wichtig-Markierung entfernen" });
    await expect(active).toHaveAttribute("aria-pressed", "true");
    await active.evaluate((button) => button.blur());
    await active.evaluate(async (button) => {
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
    expect(await visualState(page, "Wichtig-Markierung entfernen")).not.toEqual(inactive);

    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    const addEnd = page.getByRole("button", { name: "Ende hinzufügen" });
    await expect(addEnd).toBeVisible();
    await expect
      .poll(() => addEnd.evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(expectedHeight);
    await addEnd.focus();
    await page.keyboard.press("Space");
    const removeEnd = page.getByRole("button", { name: "Ende entfernen" });
    await expect(removeEnd).toBeVisible();
    await expect
      .poll(() => removeEnd.evaluate((button) => button.getBoundingClientRect().height))
      .toBeGreaterThanOrEqual(expectedHeight);
  }
});

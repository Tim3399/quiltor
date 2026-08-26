import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function openStory(page: Page, story: string, theme: "light" | "dark" = "light") {
  const params = new URLSearchParams({ story, theme });
  await page.goto(`/?${params.toString()}`);
  const canvas = page.locator("[data-design-story]");
  await expect(canvas).toHaveAttribute("data-design-story", story);
  // Theme changes are intentionally animated in production. Axe must inspect the settled colors,
  // not a transient interpolation that can report a false contrast failure mid-transition.
  await page.addStyleTag({
    content:
      "[data-design-story] *, [data-design-story] *::before, [data-design-story] *::after { transition: none !important; }",
  });
  return canvas;
}

test("catalog exposes every registered story", async ({ page }) => {
  await page.goto("/?theme=light");
  const stories = page.locator("[data-design-story-link]");
  await expect(stories.first()).toBeVisible();
  const ids = await stories.evaluateAll((links) =>
    links.map((link) => link.getAttribute("data-design-story-link")),
  );
  expect(ids.length).toBeGreaterThan(0);
  expect(new Set(ids).size).toBe(ids.length);
  const lastStory = stories.last();
  await lastStory.scrollIntoViewIfNeeded();
  await expect(lastStory).toBeVisible();
  expect(
    await page.locator(".design-gallery").evaluate((gallery) => gallery.scrollTop),
  ).toBeGreaterThan(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: every story renders without accessibility violations`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/?theme=${theme}`);
    const storyIds = await page.locator("[data-design-story-link]").evaluateAll((links) =>
      links.flatMap((link) => {
        const id = link.getAttribute("data-design-story-link");
        return id ? [id] : [];
      }),
    );
    expect(storyIds.length).toBeGreaterThan(0);

    for (const storyId of storyIds) {
      await test.step(storyId, async () => {
        const canvas = await openStory(page, storyId, theme);
        await expect(canvas).toBeVisible();

        const results = await new AxeBuilder({ page })
          .include("[data-design-story]")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${storyId} (${theme})`).toEqual([]);

        const overflow = await canvas.evaluate((element) => ({
          horizontal: element.scrollWidth > element.clientWidth + 1,
          vertical: element.scrollHeight > element.clientHeight + 1,
        }));
        expect(overflow.horizontal, `${storyId} (${theme}) overflows horizontally`).toBe(false);

        if (testInfo.project.name !== "design-touch") return;
        const undersized = await canvas
          .locator(
            "button:visible, input:visible, select:visible, textarea:visible, [role=button]:visible",
          )
          .evaluateAll((controls) =>
            controls.flatMap((control) => {
              const wrappingLabel =
                control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)
                  ? control.closest("label")
                  : null;
              const hitTarget = wrappingLabel ?? control;
              const box = hitTarget.getBoundingClientRect();
              // Bounding boxes can land a fraction below their computed CSS size
              // after browser device-scale rounding.
              if (box.width + 0.5 >= 44 && box.height + 0.5 >= 44) return [];
              return [
                `${control.tagName.toLowerCase()}[${control.getAttribute("aria-label") ?? control.textContent?.trim() ?? ""}] ${Math.round(box.width)}x${Math.round(box.height)}`,
              ];
            }),
          );
        expect(undersized, `${storyId} (${theme}) has touch targets below 44px`).toEqual([]);
      });
    }
  });
}

test("action and field primitives honor their computed visual contracts", async ({
  page,
}, testInfo) => {
  await openStory(page, "Button/Primary");
  const button = page.getByRole("button", { name: "Neue Szene" });
  const buttonMetrics = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement("span");
    probe.style.color = "var(--ink)";
    document.body.append(probe);
    const expectedBackground = getComputedStyle(probe).color;
    probe.remove();
    return {
      height: element.getBoundingClientRect().height,
      expectedHeight: Number.parseFloat(
        root.getPropertyValue(
          matchMedia("(pointer: coarse)").matches ? "--control-touch" : "--control-regular",
        ),
      ),
      background: style.backgroundColor,
      expectedBackground,
    };
  });
  expect(buttonMetrics.height).toBe(buttonMetrics.expectedHeight);
  expect(buttonMetrics.background).toBe(buttonMetrics.expectedBackground);

  const tabsBeforeButton = 3;
  for (let index = 0; index < tabsBeforeButton; index += 1) await page.keyboard.press("Tab");
  await expect(button).toBeFocused();
  const focusStyle = await button.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focusStyle).toEqual({ style: "solid", width: "2px" });

  await openStory(page, "Button/Pressed");
  const pressedButton = page.getByRole("button", { name: "Ausgewählte Ansicht" });
  await expect(pressedButton).toHaveAttribute("aria-pressed", "true");
  const pressedColors = await pressedButton.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--active-surface)";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(element).backgroundColor, expected };
  });
  expect(pressedColors.actual).toBe(pressedColors.expected);

  await openStory(page, "TextField/ErrorState");
  const invalidInput = page.getByRole("textbox", { name: "Arbeitstitel" });
  await expect(invalidInput).toHaveAttribute("aria-invalid", "true");
  const errorColors = await invalidInput.evaluate((element) => {
    const style = getComputedStyle(element);
    const probe = document.createElement("span");
    probe.style.color = "var(--error-border)";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: style.borderTopColor, expected };
  });
  expect(errorColors.actual).toBe(errorColors.expected);

  await openStory(page, "Checkbox/Disabled");
  const disabledHint = page.getByText("Diese Einstellung kann hier nicht geändert werden.");
  const disabledColors = await disabledHint.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--muted)";
    document.body.append(probe);
    const expected = getComputedStyle(probe).color;
    probe.remove();
    return { actual: getComputedStyle(element).color, expected };
  });
  expect(disabledColors.actual).toBe(disabledColors.expected);

  expect(buttonMetrics.height).toBeGreaterThanOrEqual(
    testInfo.project.name === "design-touch" ? 44 : 36,
  );
});

test("toolbar and selection patterns keep their responsive interaction contracts", async ({
  page,
}, testInfo) => {
  await openStory(page, "ToolbarButton/ResponsiveLabel");
  const toolbarButton = page.getByRole("button", { name: "Neues Kapitel" });
  const toolbarMetrics = await toolbarButton.evaluate((element) => {
    const label = element.querySelector(".ui-button__label");
    if (!(label instanceof HTMLElement)) throw new Error("ToolbarButton label is missing");
    return {
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      expectedHeight: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--control-compact"),
      ),
      labelDisplay: getComputedStyle(label).display,
      iconCenterOffset: (() => {
        const icon = element.querySelector(".ui-button__icon");
        if (!(icon instanceof HTMLElement)) throw new Error("ToolbarButton icon is missing");
        const buttonBox = element.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        return iconBox.x + iconBox.width / 2 - (buttonBox.x + buttonBox.width / 2);
      })(),
    };
  });
  if (testInfo.project.name === "design-touch") {
    expect(toolbarMetrics).toMatchObject({ width: 44, labelDisplay: "none" });
    expect(Math.abs(toolbarMetrics.iconCenterOffset)).toBeLessThanOrEqual(0.5);
  } else {
    expect(toolbarMetrics.labelDisplay).not.toBe("none");
  }
  expect(toolbarMetrics.height).toBe(toolbarMetrics.expectedHeight);
  await expect(toolbarButton).toHaveAttribute("aria-label", "Neues Kapitel");

  const longCard = await openStory(page, "SelectionCard/LongContent");
  await expect(longCard.getByRole("button")).toHaveAccessibleName(
    "Eine Welt mit einem ungewöhnlich langen Titel öffnen",
  );
  const longCardContract = await longCard.locator(".selection-card__title").evaluate((element) => {
    const style = getComputedStyle(element);
    const canvas = element.closest("[data-design-story]");
    if (!(canvas instanceof HTMLElement)) throw new Error("Design story canvas is missing");
    return {
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      canvasOverflows: canvas.scrollWidth > canvas.clientWidth + 1,
    };
  });
  expect(longCardContract).toEqual({
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    canvasOverflows: false,
  });

  const actionableCard = await openStory(page, "SelectionCard/WithTrailingActions");
  const primary = actionableCard.getByRole("button", { name: "Der letzte Garten öffnen" });
  const remove = actionableCard.getByRole("button", { name: "Der letzte Garten löschen" });
  await primary.focus();
  await expect(primary).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await expect(actionableCard.locator("button button")).toHaveCount(0);
});

test("composite components keep their keyboard and disclosure contracts", async ({ page }) => {
  await openStory(page, "Tabs/ThreeTabs");
  const cardTab = page.getByRole("tab", { name: "Karte" });
  const profileTab = page.getByRole("tab", { name: "Profil" });
  await cardTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(profileTab).toBeFocused();
  await expect(profileTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("Profilinhalt");

  await openStory(page, "ListboxSelect/Default");
  const select = page.getByRole("combobox", { name: "Sprache" });
  await select.click();
  const german = page.getByRole("option", { name: "Deutsch" });
  const english = page.getByRole("option", { name: "Englisch" });
  await expect(german).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(english).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(select).toContainText("Englisch");
  await expect(select).toHaveAttribute("aria-expanded", "false");

  await openStory(page, "Disclosure/Closed");
  const disclosure = page.locator("details");
  await expect(disclosure).not.toHaveAttribute("open", "");
  await page.getByText("Weitere Einstellungen", { exact: true }).click();
  await expect(disclosure).toHaveAttribute("open", "");
  await expect(page.getByText("Zusätzliche Optionen")).toBeVisible();
});

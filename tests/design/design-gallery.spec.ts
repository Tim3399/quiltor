import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

const storyCanvasSelector = "[data-design-story]";
// React portals are mounted as direct body children next to the gallery root. Keeping them in the
// story scope is essential: desktop Popovers and their compact Sheet presentation otherwise evade
// Axe, touch-target and overflow checks completely.
const storyPortalSelector = "body > :not(#root):not(script)";
const interactiveSelector = [
  "a[href]:visible",
  "button:visible",
  "input:visible",
  "select:visible",
  "textarea:visible",
  "summary:visible",
  "[role=button]:visible",
  "[role=link]:visible",
].join(", ");

// Horizontal scrolling is an interaction contract, not an incidental overflow fallback. The
// allowlist deliberately names the public ScrollArea API instead of implementation consumers so a
// new local `overflow-x: auto` cannot silently enter the system.
const horizontalScrollOwners = [
  {
    selector: '.scroll-area[data-axis="x"], .scroll-area[data-axis="both"]',
    reason: "ScrollArea explicitly exposes horizontal navigation through its axis contract.",
  },
] as const;

// Vertical overflow is valid only in an explicit design-owned viewport. Off-screen descendants of
// these owners are reachable by scrolling and must not be misreported as text clipped by the
// containing modal or popover shell.
const verticalScrollOwners = [
  {
    selector: '.scroll-area[data-axis="y"], .scroll-area[data-axis="both"]',
    reason: "ScrollArea explicitly exposes vertical navigation through its axis contract.",
  },
  {
    selector: ".ui-dialog__content",
    reason: "Dialog content is the bounded vertical viewport below its fixed header.",
  },
  {
    selector: ".ui-dropdown-menu, .ui-selection-menu, .ui-select-listbox, .ui-menu__submenu",
    reason: "Public menu and listbox surfaces own long option lists inside the viewport.",
  },
] as const;

// Truncation is acceptable only where the component preserves the complete value through its
// accessible name/content and intentionally trades visible length for stable action geometry.
// Adding a selector here is therefore a design-system decision which must carry a reviewable reason.
const intentionalTextTruncationOwners = [
  {
    selector: ".ui-button__label",
    reason:
      "Button keeps its full accessible name while its label yields to icons in narrow hosts.",
  },
  {
    selector: ".ui-command-palette__option-detail",
    reason: "Command names remain visible; secondary result detail is intentionally single-line.",
  },
  {
    selector: ".selection-card__title, .selection-card__description",
    reason: "SelectionCard exposes the complete primary action through its explicit aria-label.",
  },
  {
    selector: ".selectable-row__description, .selectable-row__metadata",
    reason: "SelectableRow delegates its complete action name to SelectionCard's aria-label.",
  },
  {
    selector: ".design-chip, .design-chip__label",
    reason: "A chip is a compact token; its DOM text remains available to assistive technology.",
  },
  {
    selector: ".save-status-component__state > span",
    reason: "SaveStatus retains its live-region label while protecting the adjacent retry action.",
  },
  {
    selector: ".workspace-toolbar__title strong, .workspace-toolbar__title span",
    reason: "Toolbar title and context yield to the explicitly scrollable action region.",
  },
  {
    selector: ".design-disclosure__label",
    reason: "Disclosure retains its complete summary text and a stable, visible chevron target.",
  },
  {
    selector: ".design-tabs__tab",
    reason: "Tabs retain their accessible names while sharing constrained tab-list width equally.",
  },
] as const;

// These owners intentionally render accessible text outside the visual canvas. They are excluded
// from clipping diagnostics, but not from Axe's accessibility audit.
const visuallyHiddenTextOwners = [
  { selector: ".sr-only", reason: "Shared screen-reader-only utility." },
  {
    selector: ".save-status-component__detail",
    reason: "SaveStatus announces the detailed error through its live region.",
  },
  {
    selector: ".workspace-toolbar__group > legend",
    reason: "The fieldset legend names a visual toolbar group for assistive technology.",
  },
  {
    selector: ".undo-redo-controls > legend",
    reason: "The fieldset legend names the undo/redo group for assistive technology.",
  },
] as const;

function storyRoots(page: Page) {
  return page.locator(`${storyCanvasSelector}, ${storyPortalSelector}`);
}

async function storyAxeBuilder(page: Page) {
  const builder = new AxeBuilder({ page }).include(storyCanvasSelector);
  if ((await page.locator(storyPortalSelector).count()) > 0) {
    builder.include(storyPortalSelector);
  }
  return builder;
}

async function openStory(page: Page, story: string, theme: "light" | "dark" = "light") {
  const params = new URLSearchParams({ story, theme });
  await page.goto(`/?${params.toString()}`);
  const canvas = page.locator(storyCanvasSelector);
  await expect(canvas).toHaveAttribute("data-design-story", story);
  // Theme changes are intentionally animated in production. Axe must inspect the settled colors,
  // not a transient interpolation that can report a false contrast failure mid-transition.
  await page.addStyleTag({
    content: `${storyCanvasSelector} *, ${storyCanvasSelector} *::before, ${storyCanvasSelector} *::after, ${storyPortalSelector}, ${storyPortalSelector} *, ${storyPortalSelector} *::before, ${storyPortalSelector} *::after { transition: none !important; }`,
  });
  return canvas;
}

async function expectNarrowHostContract(component: Locator, width: number) {
  await component.evaluate((element, inlineSize) => {
    if (!(element instanceof HTMLElement)) throw new Error("Narrow-host target is not an element");
    element.style.width = `${inlineSize}px`;
    element.style.maxWidth = "100%";
  }, width);

  const metrics = await component.evaluate((element) => {
    if (!(element instanceof HTMLElement)) throw new Error("Narrow-host target is not an element");
    const box = element.getBoundingClientRect();
    return {
      width: box.width,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      viewportContained: box.left >= 0 && box.right <= innerWidth + 0.5,
    };
  });
  expect(metrics.width).toBeLessThanOrEqual(width + 0.5);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.viewportContained).toBe(true);
}

async function expectCenterHit(control: Locator) {
  const hit = await control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return target === element || (target instanceof Node && element.contains(target));
  });
  expect(hit).toBe(true);
}

async function expectOwnedOverflowAndVisibleContent(
  page: Page,
  storyId: string,
  theme: "light" | "dark",
) {
  const diagnostics = await storyRoots(page).evaluateAll(
    (roots, allowances) => {
      const rootElements = roots.filter(
        (candidate): candidate is HTMLElement => candidate instanceof HTMLElement,
      );
      const candidates = [
        ...new Set(rootElements.flatMap((root) => [root, ...root.querySelectorAll("*")])),
      ].filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);
      const matches = (element: Element, owners: ReadonlyArray<{ selector: string }>) =>
        owners.some((owner) => element.matches(owner.selector));
      const withinOwner = (element: Element, owners: ReadonlyArray<{ selector: string }>) =>
        owners.some((owner) => element.closest(owner.selector));
      const visible = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        const closedDetails = element.closest("details:not([open])");
        const closedDetailsSummary = closedDetails?.querySelector(":scope > summary");
        const hiddenByClosedDetails =
          !!closedDetailsSummary &&
          closedDetailsSummary !== element &&
          !closedDetailsSummary.contains(element);
        return (
          !hiddenByClosedDetails &&
          element.getClientRects().length > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0
        );
      };
      const describe = (element: HTMLElement) => {
        const className =
          typeof element.className === "string" && element.className.trim()
            ? `.${element.className.trim().replace(/\s+/g, ".")}`
            : "";
        const role = element.getAttribute("role");
        return `${element.tagName.toLowerCase()}${className}${role ? `[role=${role}]` : ""}`;
      };
      const clientRect = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        const left = box.left + element.clientLeft;
        const top = box.top + element.clientTop;
        return {
          left,
          top,
          right: left + element.clientWidth,
          bottom: top + element.clientHeight,
        };
      };
      const clippedAxes = (
        subject: { left: number; right: number; top: number; bottom: number },
        clip: { left: number; right: number; top: number; bottom: number },
        style: CSSStyleDeclaration,
      ) => ({
        horizontal:
          ["hidden", "clip"].includes(style.overflowX) &&
          (subject.left < clip.left - 1 || subject.right > clip.right + 1),
        vertical:
          ["hidden", "clip"].includes(style.overflowY) &&
          (subject.top < clip.top - 1 || subject.bottom > clip.bottom + 1),
      });
      const containingRoot = (element: Element) =>
        rootElements.find((root) => root === element || root.contains(element));

      const unownedHorizontalScrollers = candidates.flatMap((element) => {
        if (!visible(element) || rootElements.includes(element)) return [];
        const style = getComputedStyle(element);
        const actuallyOverflows = element.scrollWidth > element.clientWidth + 1;
        const horizontallyScrollable = ["auto", "scroll"].includes(style.overflowX);
        if (
          !actuallyOverflows ||
          !horizontallyScrollable ||
          matches(element, allowances.horizontalScrollOwners)
        ) {
          return [];
        }
        return [
          `${describe(element)} ${element.clientWidth}px -> ${element.scrollWidth}px (${style.overflowX})`,
        ];
      });

      const unownedEllipsis = candidates.flatMap((element) => {
        if (!visible(element)) return [];
        const style = getComputedStyle(element);
        if (
          style.textOverflow !== "ellipsis" ||
          matches(element, allowances.intentionalTextTruncationOwners)
        ) {
          return [];
        }
        return [`${describe(element)} declares ellipsis without an audited owner`];
      });

      const clippedText = candidates.flatMap((element) => {
        if (
          !visible(element) ||
          withinOwner(element, allowances.visuallyHiddenTextOwners) ||
          matches(element, allowances.intentionalTextTruncationOwners)
        ) {
          return [];
        }
        const textNodes = [...element.childNodes].filter(
          (node): node is Text => node instanceof Text && !!node.textContent?.trim(),
        );
        if (textNodes.length === 0) return [];
        const root = containingRoot(element);
        if (!root) return [];

        const textRects = textNodes.flatMap((node) => {
          const range = document.createRange();
          range.selectNodeContents(node);
          return [...range.getClientRects()];
        });
        if (textRects.length === 0) return [];

        for (
          let ancestor: HTMLElement | null = element;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          const style = getComputedStyle(ancestor);
          const clip = clientRect(ancestor);
          const ownsVerticalScroll =
            matches(ancestor, allowances.verticalScrollOwners) &&
            ["auto", "scroll"].includes(style.overflowY) &&
            ancestor.scrollHeight > ancestor.clientHeight + 1;
          if (
            ownsVerticalScroll &&
            textRects.some(
              (textRect) => textRect.top < clip.top - 1 || textRect.bottom > clip.bottom + 1,
            )
          ) {
            return [];
          }
          const axes = textRects.reduce(
            (result, textRect) => {
              const next = clippedAxes(textRect, clip, style);
              return {
                horizontal: result.horizontal || next.horizontal,
                vertical: result.vertical || next.vertical,
              };
            },
            { horizontal: false, vertical: false },
          );
          if (axes.horizontal || axes.vertical) {
            return [
              `${describe(element)} text clipped ${axes.horizontal ? "horizontally" : ""}${
                axes.horizontal && axes.vertical ? " and " : ""
              }${axes.vertical ? "vertically" : ""} by ${describe(ancestor)}`,
            ];
          }
          if (ancestor === root) break;
        }
        return [];
      });

      const controls = [
        ...new Set(
          rootElements.flatMap((root) => [
            ...(root.matches(allowances.interactiveDomSelector) ? [root] : []),
            ...root.querySelectorAll(allowances.interactiveDomSelector),
          ]),
        ),
      ].filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);
      const clippedActions: string[] = [];
      const overlaidActions: string[] = [];

      for (const control of controls) {
        if (!visible(control) || control.closest('[aria-hidden="true"]')) continue;
        const wrappingLabel =
          control instanceof HTMLInputElement && ["checkbox", "radio"].includes(control.type)
            ? control.closest("label")
            : null;
        const hitTarget = wrappingLabel ?? control;
        if (!(hitTarget instanceof HTMLElement) || !visible(hitTarget)) continue;
        const box = hitTarget.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const root = containingRoot(control);
        if (!root) continue;

        const ownedVerticalScroller = allowances.verticalScrollOwners
          .map((owner) => control.closest<HTMLElement>(owner.selector))
          .find((owner): owner is HTMLElement => !!owner);
        if (ownedVerticalScroller) {
          const scrollStyle = getComputedStyle(ownedVerticalScroller);
          const scrollViewport = clientRect(ownedVerticalScroller);
          const waitingBehindVerticalScroll =
            ["auto", "scroll"].includes(scrollStyle.overflowY) &&
            ownedVerticalScroller.scrollHeight > ownedVerticalScroller.clientHeight + 1 &&
            (box.top < scrollViewport.top - 1 || box.bottom > scrollViewport.bottom + 1);
          if (waitingBehindVerticalScroll) continue;
        }

        for (
          let ancestor = hitTarget.parentElement;
          ancestor && ancestor !== root;
          ancestor = ancestor.parentElement
        ) {
          const axes = clippedAxes(box, clientRect(ancestor), getComputedStyle(ancestor));
          if (!axes.horizontal && !axes.vertical) continue;
          clippedActions.push(
            `${describe(control)} clipped ${axes.horizontal ? "horizontally" : ""}${
              axes.horizontal && axes.vertical ? " and " : ""
            }${axes.vertical ? "vertically" : ""} by ${describe(ancestor)}`,
          );
          break;
        }

        // A modal intentionally covers the story behind it. Controls outside that modal are not
        // treated as accidental action overlap; focus/semantics remain covered by Axe.
        const modal = root.querySelector<HTMLElement>('[aria-modal="true"]');
        if (modal && !modal.contains(control)) continue;
        const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
        if (center.x < 0 || center.x > innerWidth || center.y < 0 || center.y > innerHeight)
          continue;
        const ownedScroller = [
          ...allowances.horizontalScrollOwners,
          ...allowances.verticalScrollOwners,
        ]
          .map((owner) => control.closest<HTMLElement>(owner.selector))
          .find((owner): owner is HTMLElement => !!owner);
        if (ownedScroller) {
          const scrollViewport = clientRect(ownedScroller);
          const waitingBehindOwnedScroll =
            center.x < scrollViewport.left ||
            center.x > scrollViewport.right ||
            center.y < scrollViewport.top ||
            center.y > scrollViewport.bottom;
          if (waitingBehindOwnedScroll) continue;
        }
        const hit = document.elementFromPoint(center.x, center.y);
        if (!hit || hitTarget === hit || hitTarget.contains(hit)) continue;
        if (containingRoot(hit) === root) {
          overlaidActions.push(
            `${describe(control)} center is covered by ${describe(hit as HTMLElement)}`,
          );
        }
      }

      return {
        unownedHorizontalScrollers,
        unownedEllipsis,
        clippedText,
        clippedActions,
        overlaidActions,
      };
    },
    {
      horizontalScrollOwners,
      verticalScrollOwners,
      intentionalTextTruncationOwners,
      visuallyHiddenTextOwners,
      interactiveDomSelector:
        'a[href], button, input, select, textarea, summary, [role="button"], [role="link"]',
    },
  );

  expect(
    diagnostics.unownedHorizontalScrollers,
    `${storyId} (${theme}) has an unowned inner horizontal scroller`,
  ).toEqual([]);
  expect(
    diagnostics.unownedEllipsis,
    `${storyId} (${theme}) uses unaudited text truncation`,
  ).toEqual([]);
  expect(diagnostics.clippedText, `${storyId} (${theme}) visibly clips text`).toEqual([]);
  expect(diagnostics.clippedActions, `${storyId} (${theme}) clips an action`).toEqual([]);
  expect(diagnostics.overlaidActions, `${storyId} (${theme}) overlays an action`).toEqual([]);
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

        const results = await (await storyAxeBuilder(page))
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations, `${storyId} (${theme})`).toEqual([]);

        const rootOverflow = await storyRoots(page).evaluateAll((roots) =>
          roots.flatMap((element) => {
            if (!(element instanceof HTMLElement)) return [];
            const style = getComputedStyle(element);
            const horizontal = element.scrollWidth > element.clientWidth + 1;
            const vertical = element.scrollHeight > element.clientHeight + 1;
            const verticalIsManaged = ["auto", "scroll"].includes(style.overflowY);
            return horizontal || (vertical && !verticalIsManaged)
              ? [
                  {
                    root: element.getAttribute("data-design-story") ?? element.className,
                    horizontal,
                    vertical,
                    overflowY: style.overflowY,
                  },
                ]
              : [];
          }),
        );
        expect(rootOverflow, `${storyId} (${theme}) has an overflowing story root`).toEqual([]);

        const unmanagedInnerOverflow = await storyRoots(page).evaluateAll((roots) => {
          const candidates = roots.flatMap((root) => [root, ...root.querySelectorAll("*")]);
          return [...new Set(candidates)].flatMap((element) => {
            if (
              !(element instanceof HTMLElement) ||
              element.getAttribute("aria-hidden") === "true" ||
              element.matches("input, select, textarea") ||
              !element.clientWidth ||
              !element.clientHeight
            ) {
              return [];
            }
            const style = getComputedStyle(element);
            const horizontal = element.scrollWidth > element.clientWidth + 1;
            const vertical = element.scrollHeight > element.clientHeight + 1;
            const unmanagedHorizontal = horizontal && style.overflowX === "visible";
            const unmanagedVertical = vertical && style.overflowY === "visible";
            if (!unmanagedHorizontal && !unmanagedVertical) return [];
            return [
              {
                element: `${element.tagName.toLowerCase()}.${element.className || "(no-class)"}`,
                horizontal: unmanagedHorizontal,
                vertical: unmanagedVertical,
                client: `${element.clientWidth}x${element.clientHeight}`,
                scroll: `${element.scrollWidth}x${element.scrollHeight}`,
              },
            ];
          });
        });
        expect(
          unmanagedInnerOverflow,
          `${storyId} (${theme}) has unmanaged inner overflow`,
        ).toEqual([]);

        await expectOwnedOverflowAndVisibleContent(page, storyId, theme);

        if (testInfo.project.name !== "design-touch") return;
        const undersized = await storyRoots(page)
          .locator(interactiveSelector)
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
}) => {
  await openStory(page, "ToolbarButton/ResponsiveLabel");
  const toolbarButton = page.getByRole("button", { name: "Neues Kapitel" });
  const toolbarMetrics = await toolbarButton.evaluate((element) => {
    const label = element.querySelector(".ui-button__label");
    if (!(label instanceof HTMLElement)) throw new Error("ToolbarButton label is missing");
    const collapsed = matchMedia("(max-width: 719px), (pointer: coarse)").matches;
    return {
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      expectedHeight: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(
          collapsed ? "--control-touch" : "--control-compact",
        ),
      ),
      collapsed,
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
  if (toolbarMetrics.collapsed) {
    expect(toolbarMetrics).toMatchObject({
      width: toolbarMetrics.expectedHeight,
      labelDisplay: "none",
    });
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

test("menu stress states stay scrollable, visible and keyboard reachable", async ({ page }) => {
  await openStory(page, "DropdownMenu/LongManyItemsOpen");
  const dropdown = page.getByRole("menu", { name: "Sehr umfangreiche Elementaktionen" });
  const dropdownMetrics = await dropdown.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(dropdownMetrics.scrollHeight).toBeGreaterThan(dropdownMetrics.clientHeight);
  expect(["auto", "scroll"]).toContain(dropdownMetrics.overflowY);
  await page.keyboard.press("Escape");
  const dropdownTrigger = page.getByRole("button", { name: "Viele Aktionen" });
  await expect(dropdownTrigger).toBeFocused();
  await dropdownTrigger.press("ArrowUp");
  await expect(
    page.getByRole("menuitem", {
      name: "Das Element mit einer besonders langen Bezeichnung endgültig löschen",
    }),
  ).toBeFocused();

  await openStory(page, "ListboxSelect/LongOptions");
  await page.getByRole("combobox", { name: "Ausgabeformat" }).click();
  const listbox = page.getByRole("listbox", { name: "Ausgabeformat" });
  const listboxMetrics = await listbox.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(listboxMetrics.scrollHeight).toBeGreaterThan(listboxMetrics.clientHeight);
  expect(["auto", "scroll"]).toContain(listboxMetrics.overflowY);
  await page.keyboard.press("End");
  await expect(page.getByRole("option", { name: "Weiteres Ausgabeformat 18" })).toBeFocused();

  await openStory(page, "SelectionMenu/LongManyActions");
  const selectionMenu = page.getByRole("menu", { name: "Umfangreiche Auswahlaktionen" });
  const selectionMetrics = await selectionMenu.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(selectionMetrics.scrollHeight).toBeGreaterThan(selectionMetrics.clientHeight);
  expect(["auto", "scroll"]).toContain(selectionMetrics.overflowY);
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", {
      name: "Ausgewählten Text mit einer besonders ausführlichen Beschreibung bearbeiten",
    }),
  ).toBeFocused();

  await openStory(page, "CommandPalette/ManyResults");
  const input = page.getByRole("combobox", { name: "Befehl oder Inhalt suchen" });
  for (let index = 0; index < 23; index += 1) await input.press("ArrowDown");
  const lastResult = page.getByRole("option", {
    name: /Ein besonders ausführlich benannter Treffer am Ende der Ergebnisliste/,
  });
  await expect(lastResult).toHaveAttribute("aria-selected", "true");
  const resultIsVisible = await lastResult.evaluate((element) => {
    const item = element.getBoundingClientRect();
    const viewport = element.closest(".ui-dialog__content")?.getBoundingClientRect();
    return !!viewport && item.top >= viewport.top - 1 && item.bottom <= viewport.bottom + 1;
  });
  expect(resultIsVisible).toBe(true);
});

test("nested menus preserve arrow-key focus and viewport containment", async ({ page }) => {
  await openStory(page, "Menu/NestedSubmenu");
  const trigger = page.getByRole("menuitem", { name: "Verschieben nach" });
  await trigger.focus();
  await trigger.press("ArrowRight");
  const nested = page.getByRole("menuitem", { name: "Akt 1 · Ankunft" });
  await expect(nested).toBeFocused();
  const submenu = page.getByRole("menu", { name: "Verschieben nach" });
  const contained = await submenu.evaluate((element) => {
    const box = element.closest(".ui-popover")?.getBoundingClientRect();
    return (
      !!box && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight
    );
  });
  expect(contained).toBe(true);
  await nested.press("ArrowLeft");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});

test("workspace, tabs and side panels stay usable in narrow hosts", async ({ page }) => {
  await openStory(page, "WorkspaceToolbar/Default");
  const toolbar = page.getByRole("toolbar", { name: "Kapitelwerkzeuge" });
  await expectNarrowHostContract(toolbar, 294);
  const toolbarActions = toolbar.locator(".workspace-toolbar__actions");
  const toolbarActionMetrics = await toolbarActions.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const host = element.closest(".workspace-toolbar")?.getBoundingClientRect();
    return {
      contained: !!host && box.left >= host.left - 0.5 && box.right <= host.right + 0.5,
      overflowX: getComputedStyle(element).overflowX,
    };
  });
  expect(toolbarActionMetrics).toEqual({ contained: true, overflowX: "auto" });
  await expectCenterHit(toolbar.getByRole("button", { name: "Neues Kapitel" }));

  await openStory(page, "Tabs/ThreeTabs");
  const tabs = page.locator(".design-tabs");
  await expectNarrowHostContract(tabs, 294);
  const tabList = page.getByRole("tablist", { name: "Figurbereiche" });
  const tabListMetrics = await tabList.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const host = element.closest(".design-tabs")?.getBoundingClientRect();
    return !!host && box.left >= host.left - 0.5 && box.right <= host.right + 0.5;
  });
  expect(tabListMetrics).toBe(true);
  for (const tab of await tabList.getByRole("tab").all()) await expectCenterHit(tab);

  await openStory(page, "SidePanel/Inspector");
  const panel = page.getByRole("complementary", { name: "Figurinspektor" });
  await expectNarrowHostContract(panel, 240);
  await expectCenterHit(panel.getByRole("button", { name: "Schließen" }));
});

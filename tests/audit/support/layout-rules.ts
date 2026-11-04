// Deterministic layout rules of the audit (T-1, part B). `analyzeLayout` inspects the page in its
// current state and returns findings; part A calls it once per captured state.
//
// All DOM rules run in a single page.evaluate round trip, and only visible elements are looked
// at, so a real Quiltor page stays within a few seconds. Contrast is delegated to axe-core.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { toolbarRowFindings } from "./toolbar-row";
import type { Finding, LayoutContext, Rect, Severity } from "./types";

type RawFinding = {
  rule: string;
  severity: Severity;
  message: string;
  selector?: string;
  rect?: Rect;
};

export async function analyzeLayout(page: Page, ctx: LayoutContext): Promise<Finding[]> {
  const domFindings = await page.evaluate(collectDomFindings, {
    touch: ctx.touch,
    popupSelector: ctx.popupSelector ?? null,
    stackedSelectors: ctx.stackedSelectors ? [...ctx.stackedSelectors] : null,
  });
  const toolbarFindings: RawFinding[] = (await page.evaluate(toolbarRowFindings, 1.5)).map(
    (finding) => ({
      rule: "toolbar-row",
      severity: "high",
      message: finding.message,
      rect: finding.rect,
    }),
  );
  const contrastFindings = await collectContrastFindings(page);
  return [...domFindings, ...toolbarFindings, ...contrastFindings].map((finding) => ({
    source: "rules" as const,
    ...finding,
  }));
}

async function collectContrastFindings(page: Page): Promise<RawFinding[]> {
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  const raw: { selector: string; severity: Severity; message: string }[] = [];
  const seen = new Set<string>();
  for (const violation of results.violations) {
    for (const node of violation.nodes) {
      const target = node.target[0];
      // Nested targets (iframes, shadow roots) cannot be resolved with one selector.
      if (typeof target !== "string" || seen.has(target)) continue;
      seen.add(target);
      const data = node.any[0]?.data as { contrastRatio?: number } | undefined;
      const ratio = data?.contrastRatio;
      raw.push({
        selector: target,
        severity: typeof ratio === "number" && ratio < 3 ? "high" : "medium",
        message: node.any[0]?.message ?? "Text contrast is below the WCAG minimum.",
      });
    }
  }
  if (raw.length === 0) return [];
  const rects = await page.evaluate(
    (selectors) => {
      return selectors.map((selector) => {
        try {
          const box = document.querySelector(selector)?.getBoundingClientRect();
          if (!box) return null;
          return {
            x: Math.round(box.x),
            y: Math.round(box.y),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
        } catch {
          return null;
        }
      });
    },
    raw.map((entry) => entry.selector),
  );
  return raw.map((entry, index) => ({
    rule: "contrast",
    severity: entry.severity,
    message: entry.message,
    selector: entry.selector,
    ...(rects[index] ? { rect: rects[index] } : {}),
  }));
}

/** Runs inside the page. Must not reference anything from the module scope. */
function collectDomFindings(options: {
  touch: boolean;
  popupSelector: string | null;
  stackedSelectors: string[] | null;
}): RawFinding[] {
  const findings: RawFinding[] = [];
  const seen = new Set<string>();
  const push = (finding: RawFinding, key: string) => {
    const dedupeKey = `${finding.rule}|${key}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    findings.push(finding);
  };

  const root = document.documentElement;
  const viewportWidth = root.clientWidth;
  const viewportHeight = root.clientHeight;

  const INTERACTIVE = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="tab"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="slider"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="spinbutton"]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable=""]',
    '[contenteditable="true"]',
  ].join(",");
  // Layers that float above the page on purpose.
  const POPUP_LAYER = [
    '[role="menu"]',
    '[role="dialog"]',
    '[role="alertdialog"]',
    '[role="listbox"]',
    '[role="tooltip"]',
    '[aria-modal="true"]',
    "[popover]",
    "dialog",
    ...(options.popupSelector ? [options.popupSelector] : []),
  ].join(",");

  const roundRect = (rect: { x: number; y: number; width: number; height: number }): Rect => ({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  });

  const selectorOf = (element: Element): string => {
    const parts: string[] = [];
    let node: Element | null = element;
    while (node && node !== root && parts.length < 6) {
      const tag = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
        parts.unshift(`${tag}#${CSS.escape(node.id)}`);
        break;
      }
      let segment = tag;
      const parent: Element | null = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(
          (child) => child.tagName === node?.tagName,
        );
        if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
      if (node === element) {
        const label = element.getAttribute("aria-label");
        if (label && label.length <= 60 && !/["\\]/.test(label))
          segment += `[aria-label="${label}"]`;
      }
      parts.unshift(segment);
      node = parent;
    }
    return parts.join(" > ");
  };

  const isRendered = (element: Element): boolean => {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility !== "visible") return false;
    if (Number.parseFloat(style.opacity) === 0) return false;
    const check = (
      element as Element & {
        checkVisibility?: (options: Record<string, boolean>) => boolean;
      }
    ).checkVisibility;
    if (check) {
      return check.call(element, { checkOpacity: true, checkVisibilityCSS: true });
    }
    return true;
  };

  const isHiddenFromUsers = (element: Element): boolean =>
    element.closest('[aria-hidden="true"], [inert]') !== null;

  const isTiny = (box: DOMRect) => box.width <= 1 && box.height <= 1;

  // Visually hidden on purpose (the sr-only pattern), detected by computed style and geometry
  // rather than by class name: the element or an ancestor is clipped to zero area, or is a
  // 1x1 box that clips its content.
  const isClippedAway = (style: CSSStyleDeclaration): boolean => {
    const clip = style.clip.replace(/\s+/g, "");
    if (clip === "rect(0px,0px,0px,0px)" || clip === "rect(0,0,0,0)") return true;
    const clipPath = style.clipPath.replace(/\s+/g, "");
    return (
      clipPath === "inset(50%)" ||
      clipPath === "inset(100%)" ||
      clipPath === "circle(0)" ||
      clipPath === "circle(0px)" ||
      clipPath === "circle(0%)"
    );
  };
  const isVisuallyHidden = (element: Element): boolean => {
    if (isTiny(element.getBoundingClientRect())) return true;
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (isClippedAway(getComputedStyle(node))) return true;
    }
    return false;
  };

  // Visible part of an element after clipping by overflow ancestors. `null` means it is not
  // visible at all, `reachable` means a scroll container (or the document) can bring the rest
  // of it into view.
  const visibleGeometry = (element: Element) => {
    const box = element.getBoundingClientRect();
    let left = box.left;
    let top = box.top;
    let right = box.right;
    let bottom = box.bottom;
    let reachableX = false;
    let reachableY = false;
    let fixed = false;
    let node: Element | null = element;
    while (node && node !== root && node !== document.body) {
      const style = getComputedStyle(node);
      if (style.position === "fixed") fixed = true;
      if (node !== element) {
        const clip = (value: string) => value === "hidden" || value === "clip";
        const scroll = (value: string) =>
          value === "auto" || value === "scroll" || value === "overlay";
        const area = node.getBoundingClientRect();
        if (clip(style.overflowX) || scroll(style.overflowX)) {
          if (scroll(style.overflowX) && node.scrollWidth > node.clientWidth + 1) reachableX = true;
          left = Math.max(left, area.left);
          right = Math.min(right, area.right);
        }
        if (clip(style.overflowY) || scroll(style.overflowY)) {
          if (scroll(style.overflowY) && node.scrollHeight > node.clientHeight + 1)
            reachableY = true;
          top = Math.max(top, area.top);
          bottom = Math.min(bottom, area.bottom);
        }
        if (right <= left || bottom <= top) return null;
      }
      node = node.parentElement;
    }
    if (!fixed) {
      const bodyStyle = getComputedStyle(document.body);
      const rootStyle = getComputedStyle(root);
      const pageScrolls =
        root.scrollHeight > viewportHeight + 1 &&
        bodyStyle.overflowY !== "hidden" &&
        rootStyle.overflowY !== "hidden";
      if (pageScrolls) reachableY = true;
    }
    return { left, top, right, bottom, reachableX, reachableY };
  };

  const hasOwnText = (element: Element): boolean => {
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "") return true;
    }
    return false;
  };

  const all = Array.from(document.body.querySelectorAll("*")).filter(
    (element) => !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "svg"].includes(element.tagName),
  );
  const rendered = all.filter((element) => !element.closest("svg") && isRendered(element));

  // --- page-horizontal-scroll -------------------------------------------------------------
  const scrollWidth = Math.max(root.scrollWidth, document.body.scrollWidth);
  if (scrollWidth > viewportWidth + 1) {
    push(
      {
        rule: "page-horizontal-scroll",
        severity: "high",
        message: `The document scrolls horizontally: content is ${scrollWidth}px wide in a ${viewportWidth}px viewport.`,
        selector: "html",
        rect: { x: 0, y: 0, width: scrollWidth, height: viewportHeight },
      },
      "html",
    );
  }

  // --- popup-outside-viewport -------------------------------------------------------------
  const flaggedPopups: Element[] = [];
  if (options.popupSelector) {
    for (const popup of Array.from(document.querySelectorAll(options.popupSelector))) {
      if (!isRendered(popup)) continue;
      const box = popup.getBoundingClientRect();
      const overflowLeft = Math.max(0, -box.left);
      const overflowRight = Math.max(0, box.right - viewportWidth);
      const overflowTop = Math.max(0, -box.top);
      const overflowBottom = Math.max(0, box.bottom - viewportHeight);
      if (Math.max(overflowLeft, overflowRight, overflowTop, overflowBottom) <= 1) continue;
      const visibleWidth = Math.max(0, Math.min(box.right, viewportWidth) - Math.max(box.left, 0));
      const visibleHeight = Math.max(
        0,
        Math.min(box.bottom, viewportHeight) - Math.max(box.top, 0),
      );
      const visibleShare = (visibleWidth * visibleHeight) / (box.width * box.height);
      const sides = [
        overflowLeft > 1 ? `left by ${Math.round(overflowLeft)}px` : "",
        overflowRight > 1 ? `right by ${Math.round(overflowRight)}px` : "",
        overflowTop > 1 ? `top by ${Math.round(overflowTop)}px` : "",
        overflowBottom > 1 ? `bottom by ${Math.round(overflowBottom)}px` : "",
      ].filter(Boolean);
      flaggedPopups.push(popup);
      push(
        {
          rule: "popup-outside-viewport",
          severity: visibleShare < 0.5 ? "high" : "medium",
          message: `The open popup extends beyond the viewport (${sides.join(", ")}).`,
          selector: selectorOf(popup),
          rect: roundRect(box),
        },
        selectorOf(popup),
      );
    }
  }

  // --- outside-viewport -------------------------------------------------------------------
  for (const element of rendered) {
    if (isHiddenFromUsers(element)) continue;
    if (flaggedPopups.some((popup) => popup.contains(element))) continue;
    const interactive = element.matches(INTERACTIVE);
    if (!interactive && !hasOwnText(element)) continue;
    const box = element.getBoundingClientRect();
    if (isTiny(box)) continue;
    const geometry = visibleGeometry(element);
    if (!geometry) continue;
    const outsideX =
      !geometry.reachableX && (geometry.left < -1 || geometry.right > viewportWidth + 1);
    const outsideY =
      !geometry.reachableY && (geometry.top < -1 || geometry.bottom > viewportHeight + 1);
    if (!outsideX && !outsideY) continue;
    const parts: string[] = [];
    if (geometry.left < -1 && outsideX) parts.push(`left by ${Math.round(-geometry.left)}px`);
    if (geometry.right > viewportWidth + 1 && outsideX) {
      parts.push(`right by ${Math.round(geometry.right - viewportWidth)}px`);
    }
    if (geometry.top < -1 && outsideY) parts.push(`top by ${Math.round(-geometry.top)}px`);
    if (geometry.bottom > viewportHeight + 1 && outsideY) {
      parts.push(`bottom by ${Math.round(geometry.bottom - viewportHeight)}px`);
    }
    const fullyOutside =
      geometry.right <= 0 ||
      geometry.left >= viewportWidth ||
      geometry.bottom <= 0 ||
      geometry.top >= viewportHeight;
    push(
      {
        rule: "outside-viewport",
        severity: interactive || fullyOutside ? "high" : "medium",
        message: `${interactive ? "Interactive element" : "Text"} lies outside the viewport (${parts.join(", ")}) and no scroll container can reach it.`,
        selector: selectorOf(element),
        rect: roundRect(box),
      },
      selectorOf(element),
    );
  }

  // --- clipped-text -----------------------------------------------------------------------
  // Text that an `overflow: hidden|clip` box really cuts. The box's scroll size alone proves
  // nothing: a canvas, a panel with its own scroller or a collapsed <details> all have more
  // content than fits, and none of it is cut text. So every visible text node under the box is
  // measured with Range.getClientRects() and counts only when a line fragment lies outside the
  // box on an axis that the box itself clips. Three kinds of text are not cut by this box:
  // - text behind an inner overflow box on that axis (that box is judged on its own),
  // - text on a pan/zoom layer (an ancestor below the box has a CSS transform): a canvas shows
  //   a window onto it by design,
  // - text of a position:fixed layer, which is not clipped by the box at all.
  const clipsOverflow = (value: string) => value === "hidden" || value === "clip";
  const ownsOverflow = (value: string) => value !== "visible";
  for (const element of rendered) {
    if (element === document.body) continue;
    const style = getComputedStyle(element);
    const clipsX = clipsOverflow(style.overflowX);
    const clipsY = clipsOverflow(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const cutX = clipsX && element.scrollWidth > element.clientWidth + 1;
    const cutY = clipsY && element.scrollHeight > element.clientHeight + 1;
    if (!cutX && !cutY) continue;
    if (isVisuallyHidden(element)) continue;
    const area = element.getBoundingClientRect();
    const inner = {
      left: area.left + element.clientLeft,
      top: area.top + element.clientTop,
      right: area.left + element.clientLeft + element.clientWidth,
      bottom: area.top + element.clientTop + element.clientHeight,
    };
    let cutText = "";
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node && cutText === ""; node = walker.nextNode()) {
      const text = (node.textContent ?? "").trim();
      const parent = node.parentElement;
      if (text === "" || !parent || !isRendered(parent)) continue;
      let blockedX = false;
      let blockedY = false;
      let elsewhere = false;
      for (
        let layer: Element | null = parent;
        layer && layer !== element;
        layer = layer.parentElement
      ) {
        const layerStyle = getComputedStyle(layer);
        if (ownsOverflow(layerStyle.overflowX)) blockedX = true;
        if (ownsOverflow(layerStyle.overflowY)) blockedY = true;
        if (layerStyle.transform !== "none" || layerStyle.position === "fixed") elsewhere = true;
      }
      if (elsewhere || (blockedX && blockedY)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (rect.width < 0.5 || rect.height < 0.5) continue;
        const outX = rect.left < inner.left - 1 || rect.right > inner.right + 1;
        const outY = rect.top < inner.top - 1 || rect.bottom > inner.bottom + 1;
        if ((clipsX && !blockedX && outX) || (clipsY && !blockedY && outY)) {
          cutText = text;
          break;
        }
      }
    }
    if (cutText === "") continue;
    const ellipsis =
      style.textOverflow === "ellipsis" ||
      (style.getPropertyValue("-webkit-line-clamp") !== "" &&
        style.getPropertyValue("-webkit-line-clamp") !== "none");
    const fullTextReachable =
      element.hasAttribute("title") ||
      element.hasAttribute("aria-label") ||
      element.hasAttribute("aria-labelledby") ||
      element.closest("[title]") !== null;
    const severity: Severity = ellipsis ? (fullTextReachable ? "low" : "medium") : "high";
    const how = ellipsis
      ? fullTextReachable
        ? "truncated with an ellipsis; the full text is available through title or ARIA"
        : "truncated with an ellipsis and the full text is not available through title or ARIA"
      : "cut off by overflow without an ellipsis";
    push(
      {
        rule: "clipped-text",
        severity,
        message: `Text is ${how} (content ${element.scrollWidth}x${element.scrollHeight}px in a ${element.clientWidth}x${element.clientHeight}px box): "${cutText.slice(0, 60)}".`,
        selector: selectorOf(element),
        rect: roundRect(area),
      },
      selectorOf(element),
    );
  }

  // --- broken-word ------------------------------------------------------------------------
  // A word whose letters run onto a second line without a hyphen ("MASSST / AB"). Measured per
  // word with Range.getClientRects(): one rect per line fragment, so two distinct line tops mean
  // the word itself was split. Only runs of letters and digits count as a word, so a break after
  // a hyphen or slash ("Ort-/Karte") is not one, and neither is one at a soft hyphen (U+00AD is
  // no letter either). Hyphenation by `hyphens: auto` draws its own hyphen and is allowed.
  const WORD = /[\p{L}\p{N}\p{M}]+/gu;
  const PROMINENT =
    'h1,h2,h3,h4,h5,h6,label,legend,th,[role="heading"],[role="columnheader"],[role="tab"]';
  // Two kinds of text are not the interface's own words and are let through:
  // - machine text (paths, ids, commands in code/kbd/samp/pre): it has no syllables to hyphenate,
  //   and breaking it anywhere is how a long path is meant to fit (the backup overview on mobile);
  // - editable text: what the author typed. A word longer than the line has to break somewhere,
  //   and the editor is no place to hyphenate the manuscript behind the author's back.
  const MACHINE_TEXT = "code,kbd,samp,pre";
  const EDITABLE = '[contenteditable=""],[contenteditable="true"],textarea,[role="textbox"]';
  for (const element of rendered) {
    if (!hasOwnText(element) || isVisuallyHidden(element)) continue;
    if (element.closest(MACHINE_TEXT) || element.closest(EDITABLE)) continue;
    const hyphens = getComputedStyle(element).hyphens;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const text = child.textContent ?? "";
      for (const match of text.matchAll(WORD)) {
        const word = match[0];
        if (word.length < 2) continue;
        const start = match.index ?? 0;
        const range = document.createRange();
        range.setStart(child, start);
        range.setEnd(child, start + word.length);
        const fragments = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0.5 && rect.height > 0.5,
        );
        if (fragments.length < 2 || hyphens === "auto") continue;
        // Several fragments alone do not prove a split: after a soft hyphen Chromium reports the
        // hyphen it draws as an extra first rect of the next letter, at the end of the previous
        // line. So each letter is placed by its last rect, which is the letter itself, and
        // `split` is the first letter below the first one.
        const letter = document.createRange();
        const lineOf = (offset: number): DOMRect | undefined => {
          letter.setStart(child, start + offset);
          letter.setEnd(child, start + offset + 1);
          return Array.from(letter.getClientRects())
            .filter((rect) => rect.width > 0.5)
            .at(-1);
        };
        const first = lineOf(0);
        if (!first) continue;
        let split = 0;
        for (let offset = 1; offset < word.length; offset += 1) {
          const rect = lineOf(offset);
          if (rect && rect.top >= first.top + first.height / 2) {
            split = offset;
            break;
          }
        }
        if (split === 0) continue;
        const control = element.closest(INTERACTIVE);
        const owner = control ?? element;
        const severity: Severity = control || element.closest(PROMINENT) ? "high" : "medium";
        push(
          {
            rule: "broken-word",
            severity,
            message: `The word "${word}" breaks across lines without a hyphen ("${word.slice(0, split)}" / "${word.slice(split)}").`,
            selector: selectorOf(owner),
            rect: roundRect(range.getBoundingClientRect()),
          },
          `${selectorOf(owner)}|${word}`,
        );
      }
    }
  }

  // --- overlap ----------------------------------------------------------------------------
  const interactiveElements = rendered.filter(
    (element) =>
      element.matches(INTERACTIVE) &&
      !isHiddenFromUsers(element) &&
      getComputedStyle(element).pointerEvents !== "none",
  );
  const modal = document.querySelector('[aria-modal="true"]');
  for (const element of interactiveElements) {
    if (modal && !modal.contains(element)) continue;
    const box = element.getBoundingClientRect();
    if (isTiny(box)) continue;
    const inset = Math.max(0.5, Math.min(2, box.width / 4, box.height / 4));
    const points: [number, number, boolean][] = [
      [box.left + box.width / 2, box.top + box.height / 2, true],
      [box.left + inset, box.top + inset, false],
      [box.right - inset, box.top + inset, false],
      [box.left + inset, box.bottom - inset, false],
      [box.right - inset, box.bottom - inset, false],
    ];
    let covered = 0;
    let centerCovered = false;
    let coveredBy: Element | null = null;
    for (const [x, y, isCenter] of points) {
      if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === element || element.contains(hit) || hit.contains(element)) continue;
      const hitInteractive = hit.closest(INTERACTIVE);
      if (!hitInteractive || hitInteractive === element) continue;
      if (element.contains(hitInteractive) || hitInteractive.contains(element)) continue;
      // A popup floating over the page covers things on purpose.
      const hitLayer = hit.closest(POPUP_LAYER);
      if (hitLayer && hitLayer !== element.closest(POPUP_LAYER)) continue;
      covered += 1;
      if (isCenter) centerCovered = true;
      coveredBy = hitInteractive;
    }
    if (covered === 0 || !coveredBy) continue;
    const first = selectorOf(element);
    const second = selectorOf(coveredBy);
    push(
      {
        rule: "overlap",
        severity: centerCovered ? "high" : covered >= 2 ? "medium" : "low",
        message: `Interactive element is covered by another interactive element (${second}) at ${covered} of 5 sample points.`,
        selector: first,
        rect: roundRect(box),
      },
      [first, second].sort().join("|"),
    );
  }

  // --- overlay-stack ---------------------------------------------------------------------
  // The overlap rule above sees only a control covered by another control. A banner or a legend
  // is no control, so a breadcrumb trail lying under a hint banner (T-109) slips through it. A
  // state that stacks overlays names them, and any two that share area are reported. Elements
  // of one selector are not compared with each other.
  const stacked = options.stackedSelectors ?? [];
  const stackedBoxes = stacked.map((selector) =>
    Array.from(document.querySelectorAll(selector))
      .filter((element) => isRendered(element) && !isHiddenFromUsers(element))
      .map((element) => ({ selector, element, box: element.getBoundingClientRect() })),
  );
  for (let a = 0; a < stackedBoxes.length; a += 1) {
    for (let b = a + 1; b < stackedBoxes.length; b += 1) {
      for (const first of stackedBoxes[a] ?? []) {
        for (const second of stackedBoxes[b] ?? []) {
          const width =
            Math.min(first.box.right, second.box.right) - Math.max(first.box.left, second.box.left);
          const height =
            Math.min(first.box.bottom, second.box.bottom) - Math.max(first.box.top, second.box.top);
          if (width <= 1 || height <= 1) continue;
          push(
            {
              rule: "overlap",
              severity: "high",
              message: `Overlay ${first.selector} lies over overlay ${second.selector} (${Math.round(width)}x${Math.round(height)}px shared).`,
              selector: selectorOf(first.element),
              rect: roundRect(first.box),
            },
            `stack|${first.selector}|${second.selector}`,
          );
        }
      }
    }
  }

  // --- touch-target -----------------------------------------------------------------------
  if (options.touch) {
    for (const element of rendered) {
      if (!element.matches(INTERACTIVE) || isHiddenFromUsers(element)) continue;
      if ((element as HTMLInputElement).disabled) continue;
      const box = element.getBoundingClientRect();
      if (isTiny(box)) continue;
      // Links inside running text are exempt, as in WCAG 2.5.8.
      if (element.tagName === "A" && getComputedStyle(element).display === "inline") continue;
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      if (width >= 44 && height >= 44) continue;
      const severity: Severity = width < 24 || height < 24 ? "high" : "low";
      push(
        {
          rule: "touch-target",
          severity,
          message: `Touch target is ${width}x${height} CSS px; the minimum is ${severity === "high" ? 24 : 44}x${severity === "high" ? 24 : 44}.`,
          selector: selectorOf(element),
          rect: roundRect(box),
        },
        selectorOf(element),
      );
    }
  }

  return findings;
}

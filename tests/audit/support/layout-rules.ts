// Deterministic layout rules of the audit (T-1, part B). `analyzeLayout` inspects the page in its
// current state and returns findings; part A calls it once per captured state.
//
// All DOM rules run in a single page.evaluate round trip, and only visible elements are looked
// at, so a real Quiltor page stays within a few seconds. Contrast is delegated to axe-core.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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
  });
  const contrastFindings = await collectContrastFindings(page);
  return [...domFindings, ...contrastFindings].map((finding) => ({
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
  for (const element of rendered) {
    if (element === document.body) continue;
    const style = getComputedStyle(element);
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
    if (!clipsX && !clipsY) continue;
    const cutX = clipsX && element.scrollWidth > element.clientWidth + 1;
    const cutY = clipsY && element.scrollHeight > element.clientHeight + 1;
    if (!cutX && !cutY) continue;
    const text = (element.textContent ?? "").trim();
    if (text === "") continue;
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
    const box = element.getBoundingClientRect();
    const how = ellipsis
      ? fullTextReachable
        ? "truncated with an ellipsis; the full text is available through title or ARIA"
        : "truncated with an ellipsis and the full text is not available through title or ARIA"
      : "cut off by overflow without an ellipsis";
    push(
      {
        rule: "clipped-text",
        severity,
        message: `Text is ${how} (content ${element.scrollWidth}x${element.scrollHeight}px in a ${element.clientWidth}x${element.clientHeight}px box): "${text.slice(0, 60)}".`,
        selector: selectorOf(element),
        rect: roundRect(box),
      },
      selectorOf(element),
    );
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

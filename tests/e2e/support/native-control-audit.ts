import { expect, type Locator } from "@playwright/test";

type AuditResult = {
  audited: number;
  unstyled: string[];
};

/**
 * Audits only elements which are currently visible and really overflow. Merely declaring
 * `overflow: auto` is intentionally not enough: that would turn responsive layout changes into
 * false positives. A scrollbar is considered themed either through both CSS Scrollbars
 * properties or through authored WebKit track/thumb rules.
 */
export async function expectVisibleScrollbarsToUseQuiltorTheme(root: Locator) {
  const result: AuditResult = await root.evaluate((rootElement) => {
    const describe = (element: Element) => {
      const html = element as HTMLElement;
      const id = html.id ? `#${CSS.escape(html.id)}` : "";
      const classes = [...html.classList]
        .slice(0, 3)
        .map((name) => `.${CSS.escape(name)}`)
        .join("");
      return `${html.tagName.toLowerCase()}${id}${classes}`;
    };

    const authoredPseudoParts = (element: Element) => {
      const parts = new Set<string>();
      const inspectRules = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if ("cssRules" in rule) {
            try {
              inspectRules((rule as CSSGroupingRule).cssRules);
            } catch {
              // Cross-origin sheets and unsupported conditional rules are irrelevant here.
            }
          }
          if (!("selectorText" in rule)) continue;
          const selectorText = (rule as CSSStyleRule).selectorText;
          for (const selector of selectorText.split(",")) {
            const pseudoStart = selector.indexOf("::-webkit-scrollbar");
            if (pseudoStart < 0) continue;
            const base = selector.slice(0, pseudoStart).trim() || "*";
            try {
              if (element.matches(base)) parts.add(selector.slice(pseudoStart).trim());
            } catch {
              // A selector unsupported by this browser cannot style this element.
            }
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          inspectRules(sheet.cssRules);
        } catch {
          // The app's sheets are same-origin. Ignore browser/extension sheets defensively.
        }
      }
      return parts;
    };

    const candidates = [rootElement, ...rootElement.querySelectorAll("*")];
    const unstyled: string[] = [];
    let audited = 0;
    for (const element of candidates) {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const box = html.getBoundingClientRect();
      const visible =
        box.width > 0 &&
        box.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden";
      if (!visible) continue;
      const scrollsVertically =
        /(auto|scroll|overlay)/.test(style.overflowY) && html.scrollHeight > html.clientHeight + 1;
      const scrollsHorizontally =
        /(auto|scroll|overlay)/.test(style.overflowX) && html.scrollWidth > html.clientWidth + 1;
      if (!scrollsVertically && !scrollsHorizontally) continue;
      audited += 1;

      const standardTheming = style.scrollbarWidth !== "auto" && style.scrollbarColor !== "auto";
      const pseudoParts = authoredPseudoParts(element);
      const webkitTheming =
        [...pseudoParts].some((part) => part.startsWith("::-webkit-scrollbar-thumb")) &&
        [...pseudoParts].some(
          (part) => part === "::-webkit-scrollbar" || part.startsWith("::-webkit-scrollbar-track"),
        );
      if (!standardTheming && !webkitTheming) {
        unstyled.push(
          `${describe(element)} (scrollbar-width: ${style.scrollbarWidth}; scrollbar-color: ${style.scrollbarColor})`,
        );
      }
    }
    return { audited, unstyled };
  });

  expect(
    result.audited,
    "keine tatsächlich scrollbare Fläche im Testzustand gefunden",
  ).toBeGreaterThan(0);
  expect(result.unstyled, "sichtbare native Scrollbars ohne Quiltor-Theming").toEqual([]);
}

/**
 * Checks semantic computed styles, not pixels. Inputs/selects need a deliberate surface and
 * outline; range controls may instead use the platform implementation with Quiltor's accent.
 */
export async function expectVisibleNativeControlsToUseQuiltorTheme(root: Locator) {
  const result: AuditResult = await root.evaluate((rootElement) => {
    const describe = (element: Element) => {
      const html = element as HTMLInputElement;
      const label = html.getAttribute("aria-label") || html.name || html.type;
      return `${html.tagName.toLowerCase()}${label ? `[${label}]` : ""}`;
    };
    const hasAuthoredPseudoPart = (element: Element, pseudoPart: string) => {
      let matched = false;
      const inspectRules = (rules: CSSRuleList) => {
        for (const rule of rules) {
          if ("cssRules" in rule) {
            try {
              inspectRules((rule as CSSGroupingRule).cssRules);
            } catch {
              // See scrollbar audit above.
            }
          }
          if (!("selectorText" in rule)) continue;
          for (const selector of (rule as CSSStyleRule).selectorText.split(",")) {
            const pseudoStart = selector.indexOf(pseudoPart);
            if (pseudoStart < 0) continue;
            try {
              if (element.matches(selector.slice(0, pseudoStart).trim() || "*")) matched = true;
            } catch {
              // Unsupported selectors do not apply.
            }
          }
        }
      };
      for (const sheet of document.styleSheets) {
        try {
          inspectRules(sheet.cssRules);
        } catch {
          // Ignore inaccessible third-party sheets.
        }
      }
      return matched;
    };

    const controls = [...rootElement.querySelectorAll("input, select, textarea")].filter(
      (element) => {
        const html = element as HTMLElement;
        const style = getComputedStyle(html);
        const box = html.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden";
      },
    );
    const unstyled: string[] = [];
    for (const element of controls) {
      const input = element as HTMLInputElement;
      const style = getComputedStyle(input);
      if (input.type === "range") {
        const hasAccent = style.accentColor !== "auto";
        const hasCustomParts =
          hasAuthoredPseudoPart(input, "::-webkit-slider-track") &&
          hasAuthoredPseudoPart(input, "::-webkit-slider-thumb");
        if (!hasAccent && !hasCustomParts)
          unstyled.push(`${describe(input)} (nativer Range-Regler)`);
        continue;
      }

      if (element.tagName === "SELECT") {
        const customSelect = style.appearance === "none" && style.backgroundImage !== "none";
        if (!customSelect) {
          unstyled.push(
            `${describe(input)} (nativer Select-Pfeil; appearance: ${style.appearance}; image: ${style.backgroundImage})`,
          );
          continue;
        }
      }

      if (input.type === "number") {
        const customNumber = ["none", "textfield"].includes(style.appearance);
        if (!customNumber) {
          unstyled.push(
            `${describe(input)} (nativer Number-Spinner; appearance: ${style.appearance})`,
          );
          continue;
        }
      }

      const backgroundChannels = style.backgroundColor.match(/[\d.]+/g)?.map(Number);
      const hasSurface = (backgroundChannels?.[3] ?? 1) > 0;
      const hasOutline =
        style.borderTopStyle !== "none" && Number.parseFloat(style.borderTopWidth) > 0;
      const hasShape = Number.parseFloat(style.borderTopLeftRadius) > 0;
      if (!hasSurface || !hasOutline || !hasShape) {
        unstyled.push(
          `${describe(input)} (background: ${style.backgroundColor}; border: ${style.borderTopWidth} ${style.borderTopStyle}; radius: ${style.borderTopLeftRadius})`,
        );
      }
    }
    return { audited: controls.length, unstyled };
  });

  expect(result.audited, "keine sichtbaren nativen Formularelemente gefunden").toBeGreaterThan(0);
  expect(result.unstyled, "sichtbare native Formularelemente ohne Quiltor-Theming").toEqual([]);
}

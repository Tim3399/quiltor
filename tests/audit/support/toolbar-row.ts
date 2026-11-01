// The `toolbar-row` rule (T-104): every toolbar is exactly one row, and none of its controls is
// hidden or cut off. Shared by the layout audit (`layout-rules.ts`) and the geometry invariants
// (`tests/e2e/layout-invariants.spec.ts`), both of which hand it to page.evaluate.
//
// Runs inside the page. Must not reference anything from the module scope.

export type ToolbarRowFinding = {
  kind: "wrap" | "clipped";
  toolbar: string;
  control?: string;
  message: string;
  rect: { x: number; y: number; width: number; height: number };
};

export function toolbarRowFindings(tolerance = 1.5): ToolbarRowFinding[] {
  const findings: ToolbarRowFinding[] = [];
  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role="button"],[role="combobox"],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"]';
  const POPUP_LAYER =
    '[role="menu"],[role="dialog"],[role="listbox"],[role="tooltip"],[popover],dialog';

  const rounded = (box: DOMRect) => ({
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  });
  const nameOf = (element: Element): string => {
    const label =
      element.getAttribute("aria-label") ??
      (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
    const tag = element.tagName.toLowerCase();
    const cls = (element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0];
    return `${tag}${cls ? `.${cls}` : ""}${label ? ` "${label}"` : ""}`;
  };
  const shown = (element: Element): boolean => {
    if (element.closest('[aria-hidden="true"],[inert]')) return false;
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) return false;
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number(style.opacity) === 0) return false;
    }
    return true;
  };
  /** The visible area of a clipping box: its padding box without its scrollbars. */
  const clipArea = (element: Element) => {
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

  const toolbars = Array.from(document.querySelectorAll('[role="toolbar"]')).filter(
    (toolbar) => shown(toolbar) && !toolbar.parentElement?.closest(POPUP_LAYER),
  );
  for (const toolbar of toolbars) {
    const controls = Array.from(toolbar.querySelectorAll(INTERACTIVE)).filter((control) => {
      if (!shown(control)) return false;
      const layer = control.closest(POPUP_LAYER);
      return !layer || !toolbar.contains(layer);
    });
    if (controls.length === 0) continue;
    const toolbarName = nameOf(toolbar);

    // One row: every control crosses one common horizontal line.
    const boxes = controls.map((control) => control.getBoundingClientRect());
    const lowestTop = Math.max(...boxes.map((box) => box.top));
    const highestBottom = Math.min(...boxes.map((box) => box.bottom));
    if (lowestTop > highestBottom - tolerance) {
      const tops: number[] = [];
      for (const box of boxes) {
        if (!tops.some((top) => Math.abs(top - box.top) < box.height / 2)) tops.push(box.top);
      }
      const last = controls[boxes.findIndex((box) => box.top === lowestTop)];
      findings.push({
        kind: "wrap",
        toolbar: toolbarName,
        control: nameOf(last),
        message: `Toolbar ${toolbarName} wraps onto ${tops.length} rows; ${nameOf(last)} sits below the first row.`,
        rect: rounded(toolbar.getBoundingClientRect()),
      });
    }

    // Nothing hidden: each control lies inside every clipping box up to the toolbar, and inside
    // the toolbar itself. A scrollbar takes its height out of clientHeight, so a scrollbar drawn
    // across the buttons counts as covering them.
    for (const [index, control] of controls.entries()) {
      const box = boxes[index];
      const clippers: Element[] = [toolbar];
      for (let node = control.parentElement; node && node !== toolbar; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") clippers.push(node);
      }
      for (const clipper of clippers) {
        const area = clipper === toolbar ? toolbar.getBoundingClientRect() : clipArea(clipper);
        const out =
          box.left < area.left - tolerance ||
          box.right > area.right + tolerance ||
          box.top < area.top - tolerance ||
          box.bottom > area.bottom + tolerance;
        if (!out) continue;
        findings.push({
          kind: "clipped",
          toolbar: toolbarName,
          control: nameOf(control),
          message: `${nameOf(control)} in toolbar ${toolbarName} is hidden or cut off by ${clipper === toolbar ? "the toolbar" : nameOf(clipper)}.`,
          rect: rounded(box),
        });
        break;
      }
    }
  }
  return findings;
}

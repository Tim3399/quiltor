// Runtime enumeration of popups: every visible [aria-haspopup] trigger in a state is opened,
// photographed and analysed, every submenu (a menuitem with aria-haspopup) as well. Disclosure
// buttons that only toggle aria-expanded carry no aria-haspopup and are not counted as menus.
import type { Locator, Page } from "@playwright/test";
import type { AuditRecorder } from "./recorder";
import type { EntryKind } from "./types";

const TRIGGERS = '[aria-haspopup]:not([aria-haspopup="false"])';
const POPUP_ROLES = ["menu", "listbox", "dialog", "alertdialog"];
const POPUP_MARK = "data-audit-popup";
const TARGET_MARK = "data-audit-target";

export type EnumerationContext = {
  page: Page;
  rec: AuditRecorder;
  /** Brings the page back into the state the enumeration started from. */
  restore: () => Promise<void>;
  viewportSpecific?: boolean;
  /** Nesting depth; triggers inside an opened dialog or popover are enumerated one level deep. */
  depth?: number;
  /** Triggers inside elements matching this selector belong to another state and are skipped. */
  exclude?: string;
  /** Trigger names whose popup exists only in some viewports by design. */
  specificTriggers?: RegExp;
};

type TriggerInfo = { name: string; haspopup: string; ordinal: number };

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "unnamed"
  );
}

/**
 * Lists the visible, enabled popup triggers inside `scope`. With `pick`, tags that trigger with
 * `token` instead, so it can be located again after a re-render.
 */
async function scanTriggers(
  scope: Locator,
  exclude: string | undefined,
  pick?: { info: TriggerInfo; token: string },
): Promise<TriggerInfo[]> {
  return scope.evaluate(
    (root, args) => {
      const name = (element: Element): string => {
        const label = element.getAttribute("aria-label");
        if (label) return label.trim();
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
          if (text) return text;
        }
        return (
          (element.textContent ?? "").replace(/\s+/g, " ").trim() ||
          element.getAttribute("title") ||
          ""
        );
      };
      const usable = (element: Element) => {
        const box = element.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) return false;
        if (getComputedStyle(element).visibility === "hidden") return false;
        if (element.closest('[inert], [aria-hidden="true"]')) return false;
        if (element.getAttribute("role") === "menuitem") return false;
        if (args.exclude && element.closest(args.exclude)) return false;
        if (topModal && !topModal.contains(element)) return false;
        return (
          !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true"
        );
      };
      // While a modal is open, everything outside the active one is out of reach. The client
      // marks earlier modals inert, so the active one is the visible modal that is not.
      const modals = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter(
        (element) => {
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 && box.height > 0 && !element.closest('[inert], [aria-hidden="true"]')
          );
        },
      );
      const topModal = modals[modals.length - 1];
      const seen = new Map<string, number>();
      const found: { name: string; haspopup: string; ordinal: number }[] = [];
      for (const element of Array.from((root as Element).querySelectorAll(args.selector))) {
        if (!usable(element)) continue;
        const label = name(element);
        const ordinal = seen.get(label) ?? 0;
        seen.set(label, ordinal + 1);
        const info = {
          name: label,
          haspopup: element.getAttribute("aria-haspopup") ?? "true",
          ordinal,
        };
        if (args.pick && args.pick.info.name === label && args.pick.info.ordinal === ordinal) {
          element.setAttribute(args.mark, args.pick.token);
          return [info];
        }
        found.push(info);
      }
      return args.pick ? [] : found;
    },
    { selector: TRIGGERS, pick, mark: TARGET_MARK, exclude: exclude ?? "" },
  );
}

async function locateTrigger(
  scope: Locator,
  info: TriggerInfo,
  exclude: string | undefined,
): Promise<Locator> {
  const token = `t${Math.random().toString(36).slice(2, 10)}`;
  const tagged = await scanTriggers(scope, exclude, { info, token });
  if (tagged.length === 0) throw new Error(`Trigger "${info.name}" is no longer visible.`);
  return scope.page().locator(`[${TARGET_MARK}="${token}"]`);
}

/** Marks the popups already on screen so a newly opened one can be told apart. */
async function markExisting(page: Page): Promise<void> {
  await page.evaluate(
    ({ roles, mark }) => {
      const selector = roles.map((role) => `[role="${role}"]`).join(",");
      for (const element of Array.from(document.querySelectorAll(selector))) {
        const box = element.getBoundingClientRect();
        // A popup that is hidden now may be reused when it opens again; it must count as new then.
        if (box.width <= 0 || box.height <= 0) element.removeAttribute(mark);
        else if (!element.hasAttribute(mark)) element.setAttribute(mark, "existing");
      }
    },
    { roles: POPUP_ROLES, mark: POPUP_MARK },
  );
}

/** Waits for a popup that was not there before and returns a selector for it. */
async function findNewPopup(page: Page, timeout = 2_500): Promise<string | null> {
  const id = `p${Math.random().toString(36).slice(2, 10)}`;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const found = await page.evaluate(
      ({ roles, mark, value }) => {
        const selector = roles.map((role) => `[role="${role}"]`).join(",");
        const candidates = Array.from(document.querySelectorAll(selector)).filter((element) => {
          if (element.hasAttribute(mark)) return false;
          const box = element.getBoundingClientRect();
          return (
            box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden"
          );
        });
        // The outermost new element is the popup; a compact sheet wraps its menu.
        const outer = candidates.find(
          (element) => !candidates.some((other) => other !== element && other.contains(element)),
        );
        if (!outer) return false;
        outer.setAttribute(mark, value);
        for (const inner of candidates)
          if (inner !== outer) inner.setAttribute(mark, `${value}-inner`);
        return true;
      },
      { roles: POPUP_ROLES, mark: POPUP_MARK, value: id },
    );
    if (found) {
      // A menu that closes after its item opened a dialog is still on screen for a frame or two;
      // only a popup that stays counts.
      await page.waitForTimeout(200);
      const selector = `[${POPUP_MARK}="${id}"]`;
      if (
        await page
          .locator(selector)
          .isVisible()
          .catch(() => false)
      )
        return selector;
      await page.evaluate(
        ({ mark, value }) => {
          for (const element of Array.from(document.querySelectorAll(`[${mark}^="${value}"]`))) {
            element.setAttribute(mark, "existing");
          }
        },
        { mark: POPUP_MARK, value: id },
      );
      continue;
    }
    await page.waitForTimeout(100);
  }
  return null;
}

/**
 * A locator for an opened popup by role and accessible name. Dialogs that load data re-render
 * their root, which drops the attribute mark; the role and name survive that.
 */
async function popupLocator(page: Page, selector: string): Promise<Locator> {
  const marked = page.locator(selector).first();
  const description = await marked.evaluate((element) => {
    const labelledBy = element.getAttribute("aria-labelledby");
    const label =
      element.getAttribute("aria-label") ??
      (labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim()
        : "");
    return { role: element.getAttribute("role"), label };
  });
  if (!description.role || !description.label) return marked;
  const semantic = page
    .getByRole(description.role as Parameters<Page["getByRole"]>[0], {
      name: description.label,
      exact: true,
    })
    .filter({ visible: true })
    .last();
  return (await semantic.count()) > 0 ? semantic : marked;
}

/** Puts the mark from `selector` back on the popup, in case a re-render dropped it. */
async function remark(popup: Locator, selector: string): Promise<string> {
  const value = /="([^"]+)"/.exec(selector)?.[1];
  if (!value) return selector;
  await popup
    .evaluate((element, args) => element.setAttribute(args.mark, args.value), {
      mark: POPUP_MARK,
      value,
    })
    .catch(() => undefined);
  return selector;
}

async function clearMarks(page: Page): Promise<void> {
  await page.evaluate(
    (marks) => {
      for (const mark of marks) {
        for (const element of Array.from(document.querySelectorAll(`[${mark}]`))) {
          element.removeAttribute(mark);
        }
      }
    },
    // Popup marks stay: an enclosing popup is still addressed by its own. markExisting() drops
    // the marks of popups that have closed.
    [TARGET_MARK],
  );
}

function kindFor(haspopup: string, modal: boolean): EntryKind {
  if (haspopup === "menu" || haspopup === "true") return "menu";
  if (haspopup === "dialog") return modal ? "dialog" : "popover";
  return "popover";
}

function prefixFor(haspopup: string): string {
  if (haspopup === "menu" || haspopup === "true") return "menu";
  if (haspopup === "listbox") return "listbox";
  return "popover";
}

export async function activate(target: Locator, touch: boolean): Promise<void> {
  await target.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => undefined);
  if (touch) await target.tap({ timeout: 5_000 });
  else await target.click({ timeout: 5_000 });
}

/** Lets popover positioning and CSS transitions finish before a screenshot. */
export async function settle(page: Page, extraMs = 150): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.waitForTimeout(extraMs);
}

/** Closes what opened; restores the whole state when Escape is not enough. */
async function closePopup(ctx: EnumerationContext, selector: string): Promise<void> {
  const popup = ctx.page.locator(selector);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!(await popup.isVisible().catch(() => false))) return;
    await ctx.page.keyboard.press("Escape");
    await popup.waitFor({ state: "hidden", timeout: 1_500 }).catch(() => undefined);
  }
  if (await popup.isVisible().catch(() => false)) await ctx.restore();
}

type EnumerationResult = { opened: number; states: string[] };

/**
 * Opens every popup trigger visible in `scope` (default: the whole page), captures it, descends
 * into submenus and, for dialogs and popovers, into the triggers they contain.
 */
export async function enumeratePopups(
  ctx: EnumerationContext,
  state: string,
  scope?: Locator,
): Promise<EnumerationResult> {
  const page = ctx.page;
  const root = scope ?? page.locator("body");
  const depth = ctx.depth ?? 0;
  const result: EnumerationResult = { opened: 0, states: [] };
  let triggers: TriggerInfo[];
  try {
    triggers = await scanTriggers(root, ctx.exclude);
  } catch (error) {
    ctx.rec.fail(`${state}/enumerate`, error);
    return result;
  }
  const used = new Set<string>();
  for (const info of triggers) {
    const base = `${state}/${prefixFor(info.haspopup)}.${slug(info.name)}`;
    let childState = base;
    for (let n = 2; used.has(childState); n += 1) childState = `${base}-${n}`;
    used.add(childState);
    if (ctx.rec.has(childState)) continue;
    try {
      await markExisting(page);
      await activate(await locateTrigger(root, info, ctx.exclude), ctx.rec.touch);
      const popupSelector = await findNewPopup(page);
      if (!popupSelector) {
        throw new Error(
          `Trigger "${info.name}" (aria-haspopup=${info.haspopup}) opened no visible popup.`,
        );
      }
      const modal = (await page.locator(popupSelector).getAttribute("aria-modal")) === "true";
      const kind = kindFor(info.haspopup, modal);
      const popup = await popupLocator(page, popupSelector);
      await settle(page);
      await remark(popup, popupSelector);
      await ctx.rec.capture(childState, {
        kind,
        trigger: ctx.rec.touch ? "tap" : "click",
        popupSelector,
        viewportSpecific: ctx.viewportSpecific || ctx.specificTriggers?.test(info.name),
      });
      result.opened += 1;
      result.states.push(childState);
      const reopenThis = async () => {
        await ctx.restore();
        await markExisting(page);
        await activate(await locateTrigger(root, info, ctx.exclude), ctx.rec.touch);
        const again = await findNewPopup(page);
        if (!again) throw new Error(`Trigger "${info.name}" did not reopen.`);
        return again;
      };
      await enumerateSubmenus(ctx, childState, popupSelector, reopenThis, result);
      if (depth < 1 && kind !== "menu") {
        const nested = await enumeratePopups(
          { ...ctx, depth: depth + 1, restore: async () => void (await reopenThis()) },
          childState,
          popup,
        );
        result.opened += nested.opened;
        result.states.push(...nested.states);
      }
      await closePopup(ctx, popupSelector);
    } catch (error) {
      ctx.rec.fail(childState, error);
      await ctx.restore().catch((restoreError) => ctx.rec.fail(`${state}/restore`, restoreError));
    } finally {
      await clearMarks(page).catch(() => undefined);
    }
  }
  return result;
}

async function enumerateSubmenus(
  ctx: EnumerationContext,
  parentState: string,
  initialSelector: string,
  reopenParent: () => Promise<string>,
  result: EnumerationResult,
): Promise<void> {
  const page = ctx.page;
  const itemSelector = '[role="menuitem"][aria-haspopup]:not([aria-haspopup="false"])';
  let popupSelector = initialSelector;
  const names = await page
    .locator(`${popupSelector} ${itemSelector}`)
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("aria-label") ?? (item.textContent ?? "").trim()),
    );
  for (const [index, name] of names.entries()) {
    const state = `${parentState}/submenu.${slug(name)}`;
    try {
      if (!(await page.locator(popupSelector).isVisible())) popupSelector = await reopenParent();
      const item = page.locator(`${popupSelector} ${itemSelector}`).nth(index);
      await markExisting(page);
      if (ctx.rec.touch) await item.tap();
      else await item.hover();
      let submenu = await findNewPopup(page, 1_200);
      let trigger = ctx.rec.touch ? "tap" : "hover";
      if (!submenu) {
        await item.press("ArrowRight");
        submenu = await findNewPopup(page);
        trigger = "arrow-right";
      }
      if (!submenu) throw new Error(`Submenu "${name}" did not open.`);
      await settle(page);
      await ctx.rec.capture(state, {
        kind: "submenu",
        trigger,
        popupSelector: submenu,
        viewportSpecific: ctx.viewportSpecific,
      });
      result.opened += 1;
      result.states.push(state);
      await page.keyboard.press("ArrowLeft");
    } catch (error) {
      ctx.rec.fail(state, error);
    }
  }
}

/**
 * Opens a popup with `open`, waits for it and captures it. For popups a scenario opens on purpose
 * (menu items that open dialogs, the selection menu, hover cards).
 */
export async function captureOpened(
  ctx: EnumerationContext,
  state: string,
  kind: EntryKind,
  open: () => Promise<void>,
  options: { trigger?: string; enumerate?: boolean } = {},
): Promise<Locator | null> {
  const page = ctx.page;
  try {
    await markExisting(page);
    await open();
    // When `open` went through a menu item, that menu is still closing; it is not the popup.
    await page
      .waitForFunction(
        (mark) =>
          !Array.from(document.querySelectorAll('[role="menu"]')).some((element) => {
            const box = element.getBoundingClientRect();
            return !element.hasAttribute(mark) && box.width > 0 && box.height > 0;
          }),
        POPUP_MARK,
        { timeout: 1_500 },
      )
      .catch(() => undefined);
    const found = await findNewPopup(page, 4_000);
    if (!found) throw new Error(`No popup appeared for ${state}.`);
    const popup = await popupLocator(page, found);
    await settle(page, 300);
    const popupSelector = await remark(popup, found);
    await ctx.rec.capture(state, {
      kind,
      trigger: options.trigger,
      popupSelector,
      viewportSpecific: ctx.viewportSpecific,
    });
    if (options.enumerate) {
      await enumeratePopups({ ...ctx, depth: 1, restore: ctx.restore }, state, popup);
    }
    return popup;
  } catch (error) {
    ctx.rec.fail(state, error);
    return null;
  }
}

// Layout audit, capture side (T-1, part A). Every scenario walks one area of the interface in the
// project's viewport and theme, photographs each state, runs analyzeLayout on it and opens every
// popup trigger it finds at runtime. Results go into a partial manifest per test; the global
// teardown merges them and derives coverage. Failures inside a scenario are recorded in the
// manifest instead of failing the test: the audit reports, it does not block.
import { expect, type Locator, type Page, test } from "@playwright/test";
import { type AuditWorldOptions, mockAuditWorld } from "./support/audit-world";
import { centerOf, type Point, openContextMenu, wordPoint } from "./support/context-menu";
import {
  activate,
  captureOpened,
  type EnumerationContext,
  enumeratePopups,
  settle,
} from "./support/enumerate";
import { AuditRecorder } from "./support/recorder";
import { AUDIT_VIEWPORTS, type EntryKind, type ThemeName, type ViewportName } from "./support/types";

type Layout = "compact" | "regular" | "wide";

class Session {
  readonly layout: Layout;

  constructor(
    readonly page: Page,
    readonly rec: AuditRecorder,
    readonly viewport: ViewportName,
  ) {
    const width = AUDIT_VIEWPORTS[viewport].width;
    this.layout = width < 720 ? "compact" : width < 1100 ? "regular" : "wide";
  }

  get touch(): boolean {
    return this.rec.touch;
  }

  async tap(target: Locator): Promise<void> {
    await activate(target, this.touch);
  }

  button(name: string, exact = true): Locator {
    return this.page.getByRole("button", { name, exact });
  }

  /** Runs one step; a failure is recorded under `state` and the scenario continues. */
  async step(state: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.rec.fail(state, error);
      if (process.env.QUILTOR_AUDIT_DEBUG) {
        await this.page
          .screenshot({ path: `test-results/layout-audit/debug/${this.viewport}-${this.rec.theme}-${state.replace(/[^\w.-]+/g, "_")}.png` })
          .catch(() => undefined);
      }
    }
  }

  async view(state: string, kind: EntryKind = "view", viewportSpecific = false): Promise<void> {
    await settle(this.page, 250);
    await this.rec.capture(state, { kind, viewportSpecific });
  }

  ctx(restore: () => Promise<void>, extra: Partial<EnumerationContext> = {}): EnumerationContext {
    return { page: this.page, rec: this.rec, restore, ...extra };
  }

  async enumerate(
    state: string,
    restore: () => Promise<void>,
    options: { scope?: Locator; exclude?: string; viewportSpecific?: boolean } = {},
  ): Promise<void> {
    await enumeratePopups(
      this.ctx(restore, { exclude: options.exclude, viewportSpecific: options.viewportSpecific }),
      state,
      options.scope,
    );
  }

  /** Opens a popup on purpose (a menu item, a button) and captures it, optionally enumerating inside. */
  async opened(
    state: string,
    kind: EntryKind,
    restore: () => Promise<void>,
    open: () => Promise<void>,
    options: { trigger?: string; enumerate?: boolean; viewportSpecific?: boolean } = {},
  ): Promise<Locator | null> {
    return captureOpened(
      this.ctx(restore, { viewportSpecific: options.viewportSpecific }),
      state,
      kind,
      open,
      options,
    );
  }

  async closeAll(): Promise<void> {
    for (let index = 0; index < 3; index += 1) {
      const modal = this.page.locator('[aria-modal="true"]').filter({ visible: true });
      if ((await modal.count()) === 0) return;
      await this.page.keyboard.press("Escape");
      await this.page.waitForTimeout(150);
    }
  }

  // ---- World and workspace navigation ---------------------------------------------------------

  async openWorld(options: { failSaves?: boolean } = {}): Promise<void> {
    void options;
    await this.page.goto("/?world=gezeitenatlas");
    await expect(this.page.getByLabel("Kapiteltext")).toBeVisible({ timeout: 30_000 });
  }

  async workspace(name: "Text" | "Figuren" | "Timeline" | "Orte" | "Storyboard"): Promise<void> {
    await this.closeAll();
    await this.tap(this.page.getByRole("navigation", { name: "Arbeitsbereich" }).getByRole("button", { name, exact: true }));
    const evidence: Record<typeof name, Locator> = {
      Text: this.page.getByLabel("Kapiteltext"),
      Figuren: this.page.getByRole("region", { name: "Figuren und Beziehungen" }),
      Timeline: this.page.getByRole("region", { name: "Timeline" }),
      Orte: this.page.getByRole("region", { name: "Orte verwalten" }),
      Storyboard: this.page.getByRole("region", { name: "Storyboard" }),
    };
    await expect(evidence[name]).toBeVisible();
    await stillCanvas(this.page);
  }

  async mehr(item: string): Promise<void> {
    await this.closeAll();
    await this.tap(this.button("Mehr"));
    await this.tap(this.page.getByRole("menuitem", { name: item, exact: true }));
  }
}

/** Waits until a React Flow canvas, if any, stops adjusting its viewport. */
async function stillCanvas(page: Page): Promise<void> {
  const viewport = page.locator(".react-flow__viewport").filter({ visible: true }).first();
  if ((await viewport.count()) === 0) return;
  let previous: string | null = null;
  await expect
    .poll(
      async () => {
        const current = await viewport.getAttribute("style");
        const settled = current !== null && current === previous;
        previous = current;
        return settled;
      },
      { timeout: 10_000 },
    )
    .toBe(true)
    .catch(() => undefined);
}

// ---- Text workspace ---------------------------------------------------------------------------

const BINDER = "#chapter-binder";
const INSPECTOR = "#writing-aid-inspector";
const ASSISTANT = '[aria-label="Lokaler Assistent"]';
const PANELS = `${BINDER}, ${INSPECTOR}, ${ASSISTANT}`;

/** Waits a moment for a panel the layout may open by default; true when it showed up. */
async function appears(target: Locator, timeout = 1_500): Promise<boolean> {
  return target
    .first()
    .waitFor({ state: "visible", timeout })
    .then(
      () => true,
      () => false,
    );
}

async function openNavigation(s: Session): Promise<Locator> {
  const binder = s.page.locator(BINDER).filter({ visible: true });
  if (!(await appears(binder, s.layout === "compact" ? 200 : 1_500))) {
    await s.tap(s.button("Kapitel"));
    await expect(binder).toBeVisible();
  }
  return s.layout === "compact" ? s.page.getByRole("dialog", { name: "Kapitel" }) : binder;
}

async function openInspector(s: Session): Promise<Locator> {
  const inspector = s.page.locator(INSPECTOR).filter({ visible: true });
  if (!(await appears(inspector, s.layout === "wide" ? 1_500 : 200))) {
    await s.tap(s.button("Details"));
    await expect(inspector).toBeVisible();
  }
  return s.layout === "compact" ? s.page.getByRole("dialog", { name: "Details" }) : inspector;
}

async function openAssistant(s: Session): Promise<Locator> {
  const assistant = s.page.locator(ASSISTANT).filter({ visible: true }).first();
  if ((await assistant.count()) === 0) await s.tap(s.button("Lokalen Assistenten öffnen"));
  await expect(assistant).toBeVisible();
  return assistant;
}

async function textScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => {
    await s.openWorld();
  };
  await base();
  await s.view("workspace.text");
  await s.enumerate("workspace.text", base, { exclude: PANELS });

  // Navigation (chapter binder): actively opened where the layout starts with it closed.
  const toNavigation = async () => {
    await base();
    await openNavigation(s);
  };
  await s.step("workspace.text/navigation", async () => {
    const binder = await openNavigation(s);
    await s.view("workspace.text/navigation", s.layout === "compact" ? "overlay" : "view");
    await s.enumerate("workspace.text/navigation", toNavigation, { scope: binder });
    await s.opened("text.binder/dialog.delete-chapter", "dialog", toNavigation, async () => {
      await s.tap(binder.getByRole("button", { name: /^Kapitelaktionen: / }).first());
      await s.tap(page.getByRole("menuitem", { name: "Kapitel löschen", exact: true }));
    });
    await s.closeAll();
    await toNavigation();
    await s.opened(
      "text.binder/dialog.trash",
      "dialog",
      async () => {
        await toNavigation();
        await s.tap(page.locator(BINDER).getByRole("button", { name: "Papierkorb", exact: true }));
      },
      async () => s.tap(page.locator(BINDER).getByRole("button", { name: "Papierkorb", exact: true })),
      { enumerate: true },
    );
    await s.closeAll();
  });

  // Inspector ("Details"): chapter register, story time, note focus, writing aids.
  const toInspector = async () => {
    await base();
    await openInspector(s);
  };
  await s.step("workspace.text/inspector", async () => {
    await base();
    const inspector = await openInspector(s);
    await s.view("workspace.text/inspector", s.layout === "compact" ? "overlay" : "view");
    await s.enumerate("workspace.text/inspector", toInspector, { scope: inspector });

    const toStoryTime = async () => {
      await toInspector();
      await s.tap(page.locator(INSPECTOR).locator("summary").filter({ hasText: "Handlungszeit" }));
    };
    await s.tap(inspector.locator("summary").filter({ hasText: "Handlungszeit" }));
    await s.view("text.inspector.story-time");
    await s.enumerate("text.inspector.story-time", toStoryTime, { scope: inspector });

    const toNoteFocus = async () => {
      await toInspector();
      await s.tap(page.locator(INSPECTOR).getByRole("button", { name: "Notiz im Fokus öffnen" }));
    };
    await toInspector();
    const focusDialog = await s.opened(
      "text.inspector/dialog.note-focus",
      "dialog",
      toNoteFocus,
      async () => s.tap(page.locator(INSPECTOR).getByRole("button", { name: "Notiz im Fokus öffnen" })),
      { enumerate: true },
    );
    if (focusDialog) {
      await s.opened(
        "text.inspector/dialog.note-focus/listbox.referenz",
        "popover",
        toNoteFocus,
        async () => {
          const editor = focusDialog.getByRole("textbox").first();
          await editor.click();
          await page.keyboard.press("End");
          await page.keyboard.type(" @Ma");
        },
      );
    }
    await s.closeAll();

    for (const [tab, state] of [
      ["Nachschlagen", "text.lookup"],
      ["Prüfen", "text.check"],
      ["Einfügen", "text.insert"],
    ] as const) {
      const toTab = async () => {
        await toInspector();
        await s.tap(page.getByRole("radio", { name: "Schreibhilfe" }));
        await s.tap(page.getByRole("tab", { name: tab, exact: true }));
      };
      await s.step(state, async () => {
        await toTab();
        await s.view(state, s.layout === "compact" ? "overlay" : "view");
        await s.enumerate(state, toTab, { scope: await openInspector(s) });
      });
      if (tab === "Einfügen") {
        for (const [label, sheet] of [
          ["Figuren & Orte verwalten", "text.insert/sheet.elements"],
          ["Eigene Begriffe verwalten", "text.insert/sheet.terms"],
        ] as const) {
          await toTab();
          await s.opened(sheet, "dialog", toTab, async () => s.tap(page.getByRole("button", { name: label })), {
            enumerate: true,
          });
          await s.closeAll();
        }
      }
    }
  });

  // Assistant drawer: a side panel on wide and regular, a sheet on compact.
  const toAssistant = async () => {
    await base();
    await openAssistant(s);
  };
  await s.step("assistant", async () => {
    await toAssistant();
    const assistant = await openAssistant(s);
    await s.view("assistant", "overlay");
    await s.enumerate("assistant", toAssistant, { scope: assistant });
  });

  // Editor: context menu, selection, entity mention card.
  await s.step("workspace.text/context-menu.editor", async () => {
    await base();
    const content = page.locator(".cm-content").first();
    const menu = page.getByRole("menu", { name: "Aktionen für die Textauswahl" });
    const trigger = await openContextMenu(page, {
      touch: s.touch,
      point: () => wordPoint(content, "Hafenmeisterbüro"),
      menu,
      focus: async () => {
        const point = await wordPoint(content, "Hafenmeisterbüro");
        await page.mouse.click(point.x, point.y);
      },
    });
    await recordContextMenu(s, "workspace.text/context-menu.editor", trigger, "editor");
  });
  await s.step("workspace.text/selection-menu", async () => {
    await base();
    const content = page.locator(".cm-content").first();
    const point = await wordPoint(content, "Strömungen");
    await page.mouse.dblclick(point.x, point.y);
    const menu = page.getByRole("menu", { name: "Aktionen für die Textauswahl" });
    const shown = await menu.waitFor({ state: "visible", timeout: 1_500 }).then(
      () => true,
      () => false,
    );
    // The selection menu opens on request only (context menu, Shift+F10); a plain selection is
    // still captured, because selected text is a layout state of its own.
    await s.view("workspace.text/selection", shown ? "menu" : "view");
  });
  await s.step("workspace.text/popover.entity-mention", async () => {
    await base();
    const point = await wordPoint(page.locator(".cm-content").first(), "Mara Venn");
    await page.mouse.move(point.x - 4, point.y);
    await page.mouse.move(point.x, point.y);
    const card = page.locator(".entity-mention-card").filter({ visible: true });
    await expect(card).toBeVisible({ timeout: 5_000 });
    await settle(page);
    await s.rec.capture("workspace.text/popover.entity-mention", {
      kind: "popover",
      trigger: "hover",
      popupSelector: ".entity-mention-card",
    });
  });

  // Book export dialogs behind the "Buch exportieren" menu.
  for (const [item, state] of [
    ["DOCX fürs Lektorat", "workspace.text/dialog.manuscript-export"],
    ["EPUB für E-Reader", "workspace.text/dialog.manuscript-export-epub"],
  ] as const) {
    const toExport = async () => {
      await base();
      await s.tap(s.button("Buch exportieren"));
      await s.tap(page.getByRole("menuitem", { name: item }));
    };
    await base();
    await s.opened(state, "dialog", toExport, async () => {
      await s.tap(s.button("Buch exportieren"));
      await s.tap(page.getByRole("menuitem", { name: item }));
    }, { enumerate: true });
  }

  // Focus mode.
  const toFocus = async () => {
    await base();
    await s.tap(s.button("Fokus"));
    await expect(s.page.locator(".text-workspace.is-focus")).toBeVisible();
  };
  await s.step("workspace.text/focus", async () => {
    await toFocus();
    await s.view("workspace.text/focus");
    await s.enumerate("workspace.text/focus", toFocus);
  });
}

async function recordContextMenu(
  s: Session,
  state: string,
  trigger: string | null,
  target: string,
): Promise<void> {
  if (!trigger) throw new Error(`The ${target} context menu did not open by any trigger path.`);
  if (s.touch && trigger !== "long-press") {
    s.rec.finding({
      source: "rules",
      rule: "touch-context-menu-unreachable",
      severity: "medium",
      message: `The ${target} context menu does not open on a long-press in the ${s.viewport} viewport (${s.rec.theme}); it was reached with ${trigger}.`,
    });
  }
  const popup = s.page.getByRole("menu").filter({ visible: true }).last();
  await popup.evaluate((element) => element.setAttribute("data-audit-popup", "context"));
  await settle(s.page);
  await s.rec.capture(state, {
    kind: "context-menu",
    trigger,
    popupSelector: '[data-audit-popup="context"]',
  });
}

// ---- Overlays and shell dialogs ----------------------------------------------------------------

async function overlayScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => s.openWorld();
  await base();
  await s.view("workspace.text/shell");
  await s.enumerate("workspace.text/shell", base, { scope: page.locator("header.app-bar") });

  const viaMehr = async (state: string, item: string, extra?: (dialog: Locator) => Promise<void>) => {
    const open = async () => s.mehr(item);
    await base();
    const dialog = await s.opened(state, "dialog", async () => {
      await base();
      await open();
    }, open, { enumerate: true });
    if (dialog && extra) await s.step(`${state}/extra`, () => extra(dialog));
    await s.closeAll();
  };

  await base();
  const palette = await s.opened(
    "overlay.palette",
    "dialog",
    async () => {
      await base();
      await s.tap(s.button("Suche öffnen"));
    },
    async () => s.tap(s.button("Suche öffnen")),
    { enumerate: true },
  );
  if (palette) {
    await s.step("overlay.palette/results", async () => {
      await page.getByRole("combobox", { name: "Suchbegriff" }).fill("Mara");
      await s.view("overlay.palette/results", "dialog");
    });
  }
  await s.closeAll();

  await viaMehr("overlay.history", "Verlauf");
  await viaMehr("overlay.snapshot", "Arbeitsstand sichern");
  await viaMehr("overlay.backups", "Sicherungen", async (dialog) => {
    await s.tap(dialog.getByRole("button", { pressed: false }).filter({ hasText: "KB" }).first());
    await s.opened("overlay.backups/dialog.restore", "dialog", base, async () =>
      s.tap(dialog.getByRole("button", { name: "Sicherung wiederherstellen" })),
    );
  });
  await viaMehr("overlay.cloud", "Cloud-Synchronisation");
  await viaMehr("dialog.getting-started", "Erste Schritte");
  await viaMehr("dialog.project-export", "Projekt exportieren");
}

async function saveErrorScenario(s: Session): Promise<void> {
  const page = s.page;
  const toError = async () => {
    await s.openWorld();
    const point = await wordPoint(page.locator(".cm-content").first(), "Teer");
    await page.mouse.click(point.x, point.y);
    await page.keyboard.type(" und Tang");
    await expect(s.button("Entwurf retten")).toBeVisible({ timeout: 15_000 });
  };
  await toError();
  await s.view("save-error");
  await s.enumerate("save-error", toError, { scope: page.locator("header.app-bar") });
  await s.opened("save-error/dialog.recovery", "dialog", async () => {
    await toError();
    await s.tap(s.button("Entwurf retten"));
  }, async () => s.tap(s.button("Entwurf retten")), { enumerate: true });
}

// ---- World gate --------------------------------------------------------------------------------

async function worldGateScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Welt öffnen" })).toBeVisible({ timeout: 30_000 });
  };
  await base();
  await s.view("world-gate");
  await s.enumerate("world-gate", base);
  const dialogs: [string, string][] = [
    ["Neue Welt", "world-gate/sheet.new-world"],
    ["Papierkorb", "world-gate/sheet.trash"],
    ["Manuskript importieren", "world-gate/dialog.manuscript-import"],
    ["Projekt importieren", "world-gate/dialog.project-import"],
    ["Ebbe – Welt löschen", "world-gate/dialog.delete-world"],
  ];
  for (const [label, state] of dialogs) {
    await base();
    const dialog = await s.opened(state, "dialog", async () => {
      await base();
      await s.tap(s.button(label));
    }, async () => s.tap(s.button(label)), { enumerate: true });
    if (dialog && label === "Papierkorb") {
      await s.opened("world-gate/sheet.trash/dialog.purge", "dialog", base, async () =>
        s.tap(dialog.getByRole("button", { name: "Endgültig löschen" }).first()),
      );
    }
    await s.closeAll();
  }
}

// ---- Figures -----------------------------------------------------------------------------------

async function figuresScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => {
    await s.openWorld();
    await s.workspace("Figuren");
  };
  const node = (id: string) => page.locator(`.figure-workspace .react-flow__node[data-id="${id}"]`);
  await base();
  await s.view("workspace.figures");
  await s.enumerate("workspace.figures", base);

  await s.step("workspace.figures/context-menu.node", async () => {
    await base();
    const menu = page.getByRole("menu", { name: "Elementaktionen" });
    const trigger = await openContextMenu(page, {
      touch: s.touch,
      point: () => centerOf(node("ilse")),
      menu,
      focus: async () => node("ilse").focus(),
    });
    await recordContextMenu(s, "workspace.figures/context-menu.node", trigger, "figure node");
    await s.opened("workspace.figures/dialog.delete-element", "dialog", base, async () =>
      s.tap(page.getByRole("menuitem", { name: "Element löschen" })),
    );
    await s.closeAll();
  });

  const inspector = page.getByRole("complementary", { name: "Figuren-Inspector" });
  const toInspector = async (tab?: string) => {
    await base();
    await s.tap(node("mara"));
    await expect(inspector).toBeVisible();
    if (tab) await s.tap(inspector.getByRole("tab", { name: tab, exact: true }));
  };
  for (const [tab, state] of [
    [undefined, "figures.inspector"],
    ["Steckbrief", "figures.inspector.profile"],
    ["Beziehungen", "figures.inspector.relationships"],
  ] as const) {
    await s.step(state, async () => {
      await toInspector(tab);
      await s.view(state);
      await s.enumerate(state, () => toInspector(tab), { scope: inspector });
    });
  }
  await s.opened(
    "figures.inspector.relationships/dialog.delete",
    "dialog",
    () => toInspector("Beziehungen"),
    async () => s.tap(inspector.getByRole("button", { name: "Beziehung löschen" }).first()),
  );
  await s.closeAll();
  await s.step("figures.inspector/dialog.rename-mentions", async () => {
    await toInspector();
    const name = inspector.getByRole("textbox", { name: "Name", exact: true });
    await s.opened("figures.inspector/dialog.rename-mentions", "dialog", () => toInspector(), async () => {
      await name.fill("Mara Vennhoff");
      await name.press("Tab");
    });
    await s.closeAll();
  });

  const toEdge = async () => {
    await base();
    await s.tap(page.locator(".figure-workspace").getByRole("button", { name: /^sucht/ }).first());
    await expect(page.getByRole("region", { name: "Beziehung" })).toBeVisible();
  };
  await s.step("figures.edge", async () => {
    await toEdge();
    await s.view("figures.edge");
    await s.enumerate("figures.edge", toEdge, { scope: page.getByRole("region", { name: "Beziehung" }) });
  });
}

// ---- Timeline ----------------------------------------------------------------------------------

async function timelineScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => {
    await s.openWorld();
    await s.workspace("Timeline");
  };
  await base();
  await s.view("workspace.timeline");
  await s.enumerate("workspace.timeline", base, { exclude: '[aria-label="Beziehung"]' });

  const toRelationship = async () => {
    await base();
    // The first moment changes no relationship; "Alle Beziehungen" lists every card.
    await s.tap(page.getByRole("radio", { name: "Alle Beziehungen" }));
    await s.tap(page.locator(".relationship-change-card").first());
    await expect(page.getByRole(s.layout === "compact" ? "dialog" : "complementary", { name: "Beziehung" })).toBeVisible();
  };
  await s.step("timeline.relationship", async () => {
    await toRelationship();
    await s.view("timeline.relationship", s.layout === "compact" ? "overlay" : "view");
    await s.enumerate("timeline.relationship", toRelationship, {
      scope: page.locator('[aria-label="Beziehung"]').filter({ visible: true }).last(),
    });
  });

  const toLastMoment = async () => {
    await base();
    // "Nachspiel" is the one moment no chapter refers to, so it may be deleted.
    await s.tap(page.getByRole("button", { name: /^4 Nachspiel/ }));
  };
  await s.step("workspace.timeline/dialog.delete-moment", async () => {
    await toLastMoment();
    await s.opened("workspace.timeline/dialog.delete-moment", "dialog", toLastMoment, async () => {
      await s.tap(s.button("Aktionen"));
      await s.tap(page.getByRole("menuitem", { name: "Löschen", exact: true }));
    });
    await s.closeAll();
  });
}

// ---- Places ------------------------------------------------------------------------------------

async function placesScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => {
    await s.openWorld();
    await s.workspace("Orte");
  };
  const place = (id: string) => page.locator(`.places-flow-area .react-flow__node[data-id="${id}"]`);
  await base();
  await s.view("workspace.places");
  await s.enumerate("workspace.places", base);

  await s.step("workspace.places/expanded-map", async () => {
    await base();
    await s.tap(place("archivort"));
    await s.closeAll();
    await stillCanvas(page);
    await expect(page.locator(".place-map-chrome").first()).toBeVisible();
    await s.view("workspace.places/expanded-map");
  });

  // Selecting a place: side panel on wide screens, sheet up to 820 px (tablet included).
  const toSelected = async () => {
    await base();
    await s.tap(place("insel"));
    await expect(page.locator('[aria-label="Orte-Inspector"]').filter({ visible: true })).toBeVisible();
  };
  await s.step("places.selected", async () => {
    await toSelected();
    await s.view("places.selected", s.layout === "wide" ? "view" : "overlay");
    await s.enumerate("places.selected", toSelected, { viewportSpecific: true });
    await s.opened(
      "places.selected/dialog.delete-place",
      "dialog",
      toSelected,
      async () => {
        const actions = s.button("Ortsaktionen");
        if (await actions.isEnabled().catch(() => false)) {
          await s.tap(actions);
          await s.tap(page.getByRole("menuitem", { name: "Ort löschen" }));
        } else {
          await s.tap(page.getByRole("dialog", { name: "Orte-Inspector" }).getByRole("button", { name: /löschen/ }).first());
        }
      },
    );
    await s.closeAll();
  });
}

// ---- Storyboard --------------------------------------------------------------------------------

async function storyboardScenario(s: Session): Promise<void> {
  const page = s.page;
  const base = async () => {
    await s.openWorld();
    await s.workspace("Storyboard");
  };
  await base();
  await s.view("workspace.storyboard");
  await s.enumerate("workspace.storyboard", base);

  const toEdge = async () => {
    await base();
    await s.tap(page.locator(".storyboard-flow").getByText("führt zu", { exact: true }).first());
    await expect(page.getByRole("region", { name: "Verbindung" })).toBeVisible();
  };
  await s.step("storyboard.edge", async () => {
    await toEdge();
    await s.view("storyboard.edge");
    await s.enumerate("storyboard.edge", toEdge, { scope: page.getByRole("region", { name: "Verbindung" }) });
  });

  const focusButton = () =>
    page.locator('.storyboard-flow .react-flow__node[data-id="story-note-1"]').getByRole("button", { name: "Notiz im Fokus öffnen" });
  await base();
  await s.opened(
    "workspace.storyboard/dialog.note-focus",
    "dialog",
    async () => {
      await base();
      await s.tap(focusButton());
    },
    async () => s.tap(focusButton()),
    { enumerate: true },
  );
  await s.closeAll();

  await s.step("workspace.storyboard/library", async () => {
    await base();
    const library = page.getByRole("complementary", { name: "Elementbibliothek" });
    // Open by default on wide screens, closed on narrow ones.
    if (!(await appears(library, 500))) await s.tap(s.button("Elementbibliothek ein-/ausblenden"));
    await expect(library).toBeVisible();
    await s.view("workspace.storyboard/library");
  });
}

// ---- Test registration -------------------------------------------------------------------------

const SCENARIOS: { name: string; world?: AuditWorldOptions; run: (s: Session) => Promise<void> }[] = [
  { name: "world-gate", run: worldGateScenario },
  { name: "text", run: textScenario },
  { name: "overlays", run: overlayScenario },
  { name: "save-error", world: { failSaves: true }, run: saveErrorScenario },
  { name: "figures", run: figuresScenario },
  { name: "timeline", run: timelineScenario },
  { name: "places", run: placesScenario },
  { name: "storyboard", run: storyboardScenario },
];

for (const scenario of SCENARIOS) {
  test(`audit capture: ${scenario.name}`, async ({ page }, testInfo) => {
    const { viewport, theme } = testInfo.project.metadata as { viewport: ViewportName; theme: ThemeName };
    const rec = new AuditRecorder(page, testInfo.project.name, scenario.name, viewport, theme);
    await page.addInitScript((selected) => {
      localStorage.setItem("quiltor-theme", selected);
      localStorage.setItem("quiltor-interface-language", "de");
    }, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // An uncaught client error usually means a mock answers in a shape the client rejects.
    page.on("pageerror", (error) => rec.fail(`${scenario.name}/page-error`, error));
    await mockAuditWorld(page, scenario.world);
    const session = new Session(page, rec, viewport);
    try {
      await scenario.run(session);
    } catch (error) {
      rec.fail(scenario.name, error);
    } finally {
      rec.write();
    }
  });
}

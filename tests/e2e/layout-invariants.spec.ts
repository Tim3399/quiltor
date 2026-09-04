import { expect, type Page, test } from "@playwright/test";
import { mockRequiredWorldDocuments } from "./support/application-api";

/*
 * Geometrie-Invarianten.
 *
 * Die uebrigen Pruefungen des Projekts sehen Farbe, Abstand, Radius, Typo, Kontrast,
 * Importgrenzen, CSS-Ownership und Story-Abdeckung -- aber keine Geometrie. Genau dort lagen
 * die Fehler, die beim Umbau auf die Werkstatt-Richtung entstanden sind: ein Panel, das seine
 * Rasterspalte nicht ausfuellte; ein Knopf, der ausserhalb seiner Karte lag; zwei schwebende
 * Werkzeuge im selben Streifen; eine Spalte, die eine Ansicht bekam, die es dort nicht gibt.
 *
 * Diese Datei prueft nicht, wie etwas aussieht, sondern nur, dass nichts irgendwo liegt, wo es
 * nichts zu suchen hat. Damit ist sie plattformunabhaengig und braucht keine Pixel-Baseline.
 */

const TOLERANCE = 1.5;

const manuscript = {
  chapters: [
    {
      id: "c1",
      title: "Die Ankunft",
      body: "Der Morgen lag still über dem Hafen. Zwischen den Masten schimmerte das Archiv.",
      note: "Die Unruhe der Stadt nur andeuten.",
    },
    { id: "c2", title: "Das Archiv", body: "Acht Wörter stehen hier schon bereit.", note: "" },
  ],
  words: [],
  zeichenAktiv: [],
};

const figures = {
  nodes: [
    {
      id: "mara",
      x: 120,
      y: 120,
      type: "person" as const,
      name: "Mara Venn",
      label: "Kartographin",
      sub: "Liest lebende Karten.",
    },
    {
      id: "archiv",
      x: 460,
      y: 300,
      type: "ort" as const,
      name: "Gezeitenarchiv",
      label: "Ort",
      sub: "Ein gläserner Bau am Hafen.",
      mapX: 35,
      mapY: 45,
    },
    {
      id: "gilde",
      x: 460,
      y: 120,
      type: "organisation" as const,
      name: "Kartographengilde",
      label: "Organisation",
      sub: "Kontrolliert die Seewege.",
    },
    {
      id: "hafenkarte",
      x: 120,
      y: 300,
      type: "ort" as const,
      name: "Nordhafen",
      label: "Ort",
      sub: "Eine begehbare Karte.",
      mapImageId: "karte-1",
      mapWidth: 800,
      mapHeight: 600,
    },
    // Zwei Orte, die auf der Karte stehen statt auf der Ebene: sie erscheinen erst, wenn die
    // Karte aufgeklappt ist, und werden dann aus ihr abgeleitet statt gehalten.
    {
      id: "steg",
      x: 0,
      y: 0,
      type: "ort" as const,
      name: "Steg",
      label: "Ort",
      sub: "Auf der Karte.",
      parentPlaceId: "hafenkarte",
      mapX: 30,
      mapY: 40,
    },
    {
      id: "kran",
      x: 0,
      y: 0,
      type: "ort" as const,
      name: "Kran",
      label: "Ort",
      sub: "Auch auf der Karte.",
      parentPlaceId: "hafenkarte",
      mapX: 70,
      mapY: 60,
    },
  ],
  edges: [{ id: "e1", from: "mara", to: "archiv", label: "hütet", gerichtet: true }],
  timeline: [{ id: "t1", title: "Ankunft", date: "1847-09-03", note: "Mara erreicht den Hafen." }],
  presence: [],
};

async function mockWorkshop(page: Page) {
  await page.route("**/api/version", (route) =>
    route.fulfill({ json: { ok: true, version: "layout" } }),
  );
  await page.route("**/api/whoami", (route) => route.fulfill({ json: { ok: false } }));
  const world = {
    id: "layout",
    title: "Der gläserne Atlas",
    backupUrl: "",
    updated: "2026-09-03T12:00:00Z",
  };
  await page.route("**/api/worlds", (route) =>
    route.fulfill({ json: { ok: true, worlds: [world] } }),
  );
  await page.route("**/api/worlds/open", (route) => route.fulfill({ json: { ok: true, world } }));
  await mockRequiredWorldDocuments(page, { manuscript, storyWorld: figures });
  await page.route("**/api/assistant/status*", (route) =>
    route.fulfill({
      json: { ok: true, available: false, mode: "local", reason: "-", chunks: 0 },
    }),
  );
}

/** Every violation as one readable line; an empty list is the pass. */
async function violations(page: Page, tolerance: number): Promise<string[]> {
  return page.evaluate((tol) => {
    const found: string[] = [];
    const box = (element: Element) => element.getBoundingClientRect();

    const name = (element: Element) => {
      const classes = (element.className ?? "")
        .toString()
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .join(".");
      const label = element.getAttribute("aria-label");
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}${
        label ? ` [${label}]` : ""
      }`;
    };

    const visible = (element: Element) => {
      const rect = box(element);
      if (rect.width < 1 || rect.height < 1) return false;
      const style = getComputedStyle(element);
      return style.visibility !== "hidden" && style.opacity !== "0";
    };

    // 1. Ein Panel fuellt seine Rasterspalte. Sonst bleibt daneben ein toter Streifen, der
    //    aussieht wie ein Fehler und keiner ist -- oder das Panel laeuft ueber seine Spur.
    for (const layout of document.querySelectorAll<HTMLElement>(".figure-layout, .text-layout")) {
      const tracks = getComputedStyle(layout)
        .gridTemplateColumns.split(" ")
        .map((value) => Number.parseFloat(value));
      const children = [...layout.children].filter(visible);
      children.forEach((child, index) => {
        const track = tracks[index];
        if (!Number.isFinite(track)) return;
        const width = box(child).width;
        if (Math.abs(width - track) > tol) {
          found.push(
            `${name(child)} ist ${width.toFixed(0)}px breit, seine Rasterspalte ${track.toFixed(0)}px`,
          );
        }
      });
    }

    // 2. Was auf einer Karte steht, steht auch auf ihr. Ein Knopf ausserhalb ist nicht nur
    //    haesslich, er ist unerreichbar.
    for (const card of document.querySelectorAll(
      ".story-node, .place-map-node, .storyboard-node",
    )) {
      const outer = box(card);
      for (const control of card.querySelectorAll("button")) {
        if (!visible(control)) continue;
        const inner = box(control);
        const escapes =
          inner.left < outer.left - tol ||
          inner.right > outer.right + tol ||
          inner.top < outer.top - tol ||
          inner.bottom > outer.bottom + tol;
        if (escapes) found.push(`${name(control)} liegt ausserhalb von ${name(card)}`);
      }
    }

    // 3. Schwebende Werkzeuge teilen sich einen Rand, nicht denselben Fleck.
    const floating = [
      ...document.querySelectorAll(
        ".react-flow__panel.react-flow__controls, .react-flow__panel.react-flow__minimap, .timeline-strip, .place-level-trail, .graph-edge-inspector",
      ),
    ].filter(visible);
    for (let left = 0; left < floating.length; left += 1) {
      for (let right = left + 1; right < floating.length; right += 1) {
        const a = box(floating[left]);
        const b = box(floating[right]);
        const overlaps =
          a.left < b.right - tol &&
          a.right > b.left + tol &&
          a.top < b.bottom - tol &&
          a.bottom > b.top + tol;
        if (overlaps) {
          found.push(`${name(floating[left])} liegt über ${name(floating[right])}`);
        }
      }
    }

    // 4. Chrome scrollt nicht seitwaerts. Tut es das, ist etwas darin zu breit geraten.
    //    Geclippte Flaechen sind ausgenommen: dort ragt bewusst etwas ueber die Kante --
    //    der Ziehrand eines Panels etwa, den man von beiden Seiten greifen koennen soll --
    //    und niemand kann es je zu Gesicht bekommen.
    for (const region of document.querySelectorAll(
      ".side-panel, .workspace-toolbar, .status-bar, .app-bar",
    )) {
      if (!visible(region)) continue;
      const overflowX = getComputedStyle(region).overflowX;
      if (overflowX === "hidden" || overflowX === "clip") continue;
      if (region.scrollWidth > region.clientWidth + tol) {
        found.push(
          `${name(region)} scrollt seitwärts: ${region.scrollWidth}px Inhalt in ${region.clientWidth}px`,
        );
      }
    }

    return found;
  }, tolerance);
}

const workspaces = ["Text", "Figuren", "Timeline", "Orte", "Storyboard"] as const;

for (const workspace of workspaces) {
  test(`${workspace}: nichts liegt ausserhalb seines Platzes`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("quiltor-theme", "light");
      localStorage.setItem("quiltor-interface-language", "de");
    });
    await mockWorkshop(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
    await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

    if (workspace !== "Text") {
      await page.getByRole("button", { name: workspace, exact: true }).click();
    }

    // Die Steuerspalte gibt es erst, wenn etwas ausgewaehlt ist -- ohne diesen Schritt
    // pruefte der Test genau den Zustand, in dem die interessanten Panels fehlen. Unterhalb
    // der Spaltenbreite ist die Steuerung ein Sheet und kein Panel; dort gibt es nichts
    // auszurichten, also entfaellt der Schritt.
    const spalten = (page.viewportSize()?.width ?? 0) > 820;
    if (spalten && workspace === "Figuren") {
      await page.locator(".world-overview__item").first().click();
      await expect(page.locator(".figure-inspector")).toBeVisible();
    }
    if (spalten && workspace === "Orte") {
      await page.locator(".story-node").first().click();
      await expect(page.locator(".places-inspector")).toBeVisible();
    }
    // Die Leinwaende passen ihren Ausschnitt beim Ankommen an; erst danach stehen die
    // Rechtecke, die hier gemessen werden.
    await page.waitForTimeout(900);

    expect(await violations(page, TOLERANCE)).toEqual([]);
  });
}

/*
 * Ein Menue liegt auf dem, woraus es aufgeklappt wurde.
 *
 * Der Fehler dahinter war nicht zu sehen, sondern nur zu messen: das ueberlaufende Menue der
 * Kopfleiste stand auf --z-popover: 30, die Assistenten-Schublade auf --z-drawer-panel: 70.
 * Bei offener Schublade oeffnete sich das Menue also unsichtbar dahinter -- aria-expanded
 * sagte "true", der Fokus sass darin, zu sehen war nichts. Jede Pruefung, die nur den
 * Zustand liest, haelt das fuer richtig; erst die Frage "was liegt tatsaechlich an dieser
 * Stelle?" findet es.
 */
test("Menues liegen ueber der geoeffneten Schublade", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();

  test.skip(
    (page.viewportSize()?.width ?? 0) <= 820,
    "Schmal ist die Schublade ein Sheet und verdraengt das Menue, statt neben ihm zu stehen.",
  );

  await page.getByRole("button", { name: "Lokalen Assistenten öffnen" }).click();
  await page.getByRole("button", { name: "Mehr" }).click();

  const menu = page.locator(".ui-popover");
  await expect(menu).toBeVisible();

  const verdeckt = await page.evaluate(() => {
    const popover = document.querySelector(".ui-popover");
    if (!popover) return "kein Menue im Baum";
    const box = popover.getBoundingClientRect();
    // Nicht die Mitte: dort kann eine Luecke zwischen zwei Eintraegen liegen. Ein Punkt
    // knapp unter der Oberkante trifft immer den ersten Eintrag.
    const treffer = document.elementFromPoint(box.left + box.width / 2, box.top + 12);
    if (!treffer) return "an dieser Stelle liegt nichts";
    return popover.contains(treffer)
      ? ""
      : `verdeckt von ${treffer.tagName.toLowerCase()}.${treffer.className}`;
  });

  expect(verdeckt).toBe("");
});

/*
 * Ein Monogramm sitzt in der Mitte seines Kreises.
 *
 * Herausgezoomt schrumpft eine Ortskarte auf 32 Pixel mit einem Buchstaben darin. Die
 * Kartenkarte schob ihre Schrift dabei weiter um 38 Prozent nach rechts -- die Spalte neben
 * dem Vorschaubild, das es in dieser Groesse gar nicht mehr gibt. Zehn Pixel aus der Mitte
 * eines Kreises sieht man sofort, messen liess es sich vorher trotzdem nirgends.
 */
test("Orte: Monogramme sitzen mittig im Kreis", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  // Der Kreis erscheint erst weit herausgezoomt; die Leinwand kennt dafuer keine Abkuerzung.
  const kleiner = page.locator(".react-flow__controls-zoomout");
  for (let schritt = 0; schritt < 6; schritt += 1) {
    await kleiner.click();
    await page.waitForTimeout(120);
  }
  await expect(page.locator(".story-node.zoom-overview.is-map")).toHaveCount(1);

  const versatz = await page.evaluate(() => {
    const found: string[] = [];
    for (const node of document.querySelectorAll(".story-node.zoom-overview")) {
      const monogram = node.querySelector(".node-monogram");
      if (!monogram) continue;
      const box = node.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(monogram);
      const ink = range.getBoundingClientRect();
      const offset = ink.left + ink.width / 2 - (box.left + box.width / 2);
      if (Math.abs(offset) > 1.5) {
        found.push(`${monogram.textContent} steht ${offset.toFixed(1)}px neben der Mitte`);
      }
    }
    return found;
  });

  expect(versatz).toEqual([]);
});

/*
 * Die Uebersichtskarte zeigt, was auf der Leinwand steht.
 *
 * Sie zeigte die aufgeklappte Karte und liess alles weg, was darauf stand. Der Grund liegt
 * nicht im Zeichnen: React Flow nimmt in die Uebersichtskarte nur Knoten auf, die eine
 * Groesse mitbringen (`nodeHasDimensions`). Eine Karte nennt ihre selbst, eine gewoehnliche
 * Ortskarte laesst sich messen -- und die Messung wird dem Knoten zugestellt, den der Fluss
 * in seiner eigenen Liste haelt. Die Orte auf einer Karte werden aber aus der Karte
 * abgeleitet und stehen dort nicht, also ging ihre Messung ins Leere.
 *
 * Gezaehlt wird deshalb gegen die Leinwand, nicht gegen eine feste Zahl: was dort steht,
 * gehoert auch in die Uebersicht.
 */
test("Orte: die Uebersichtskarte zeigt auch, was auf einer Karte steht", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
  await mockWorkshop(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Der gläserne Atlas – Welt öffnen" }).click();
  await expect(page.getByRole("contentinfo", { name: "Arbeitsstand" })).toBeVisible();
  await page.getByRole("button", { name: "Orte", exact: true }).click();

  // Unterhalb der Spaltenbreite blendet die Leinwand ihre Uebersichtskarte aus; dann gibt es
  // nichts zu vergleichen.
  test.skip((page.viewportSize()?.width ?? 0) <= 719, "Schmal gibt es keine Uebersichtskarte.");
  await expect(page.locator(".react-flow__minimap")).toBeVisible();

  // Erst aufgeklappt gibt es ueberhaupt Orte, die auf einer Karte stehen.
  await page.getByRole("button", { name: "Nordhafen aufklappen" }).click();
  await expect(page.locator(".react-flow__node-placeMap")).toHaveCount(1);
  await page.waitForTimeout(900);

  const zahlen = await page.evaluate(() => ({
    leinwand: document.querySelectorAll(".react-flow__node").length,
    uebersicht: document.querySelectorAll(".react-flow__minimap-node").length,
  }));

  expect(zahlen.leinwand).toBeGreaterThan(2);
  expect(zahlen.uebersicht).toBe(zahlen.leinwand);
});

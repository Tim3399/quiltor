import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { encodeStoryWorldDocument } from "./support/application-api";
import {
  expandedMapState,
  mockExpandedMapWorld,
  openExpandedMapWorld,
  waitForMapViewport,
} from "./support/expanded-map-fixture";
import { createTestWorld, expect, test } from "./support/world-fixture";

/*
 * The same command must stand in the same place in every state of a node.
 *
 * A place card listed "show as pin" after "open"; the pin it turns into listed them the other
 * way round. Neither state was wrong on its own, a unit test of the markup saw the right DOM
 * order, and a screenshot only ever compared the card with its own earlier picture. What the
 * eye compares is the order on the screen -- so this reads it there: every visible command of
 * a surface, sorted by where its bounding box lies, with each command reduced to the action
 * it performs.
 *
 * The node kinds are those the application registers with the canvas: `place` (PlaceNode,
 * which also draws a map), `story` (the figure card) and `storyboard` (note, reference, board
 * and group). tests/e2e/node-command-order.spec.ts is the only place that lists them again;
 * the "known node kinds" test below fails when a new kind appears without being added here.
 */

/** An action as the eye knows it, matched on the accessible name. */
type ActionTable = Record<string, RegExp>;

const PLACE_ACTIONS: ActionTable = {
  display: /als (Stecknadel|Karte) anzeigen$/,
  lock: /(feststellen|lösen)$/,
  crop: /^Bild in .* anpassen$/,
  open: /( öffnen|etwas anlegen)$/,
  expand: /(aufklappen|einklappen)$/,
};

const STORYBOARD_ACTIONS: ActionTable = {
  focus: /^Notiz im Fokus öffnen$/,
  open: /^(Original|Storyboard) öffnen$/,
  resize: /^Element skalieren$/,
};

interface Command {
  action: string;
  label: string;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Visible commands of a surface in reading order: rows top to bottom, a row left to right.
 * Opacity does not count -- a command that only fades in on hover still has its place.
 */
async function commandsOf(scope: Locator, table: ActionTable): Promise<Command[]> {
  const found: Command[] = [];
  const buttons = scope.getByRole("button");
  for (let index = 0; index < (await buttons.count()); index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox();
    if (!box || box.width === 0 || box.height === 0) continue;
    const label = (await button.getAttribute("aria-label")) ?? (await button.innerText()).trim();
    const action = Object.keys(table).find((key) => table[key].test(label));
    if (action) found.push({ action, label, box });
  }
  const rowHeight = Math.min(
    ...found.map((command) => command.box.height),
    Number.POSITIVE_INFINITY,
  );
  return found.sort((a, b) => {
    const rowDelta = a.box.y + a.box.height / 2 - (b.box.y + b.box.height / 2);
    if (Math.abs(rowDelta) > rowHeight / 2) return rowDelta;
    return a.box.x - b.box.x;
  });
}

const actionsOf = (commands: Command[]) => commands.map((command) => command.action);

/** The commands both states offer, in the order each state shows them. */
function sharedOrder(first: Command[], second: Command[]) {
  const inSecond = new Set(actionsOf(second));
  const inFirst = new Set(actionsOf(first));
  return {
    first: actionsOf(first).filter((action) => inSecond.has(action)),
    second: actionsOf(second).filter((action) => inFirst.has(action)),
  };
}

function expectSameOrder(
  firstName: string,
  first: Command[],
  secondName: string,
  second: Command[],
  minimum: number,
) {
  const shared = sharedOrder(first, second);
  const detail = `${firstName}: ${first.map((c) => c.label).join(" | ")}\n${secondName}: ${second
    .map((c) => c.label)
    .join(" | ")}`;
  expect(
    shared.first.length,
    `Too few shared commands to compare.\n${detail}`,
  ).toBeGreaterThanOrEqual(minimum);
  expect(
    shared.first,
    `${firstName} and ${secondName} order their commands differently.\n${detail}`,
  ).toEqual(shared.second);
}

async function useGermanTheme(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("quiltor-theme", "light");
    localStorage.setItem("quiltor-interface-language", "de");
  });
}

function placeNode(page: Page, id: string) {
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

test("Known node kinds: every node type the canvases register is covered here", async () => {
  // Reading the sources keeps this honest: a new kind is a new surface whose commands need a
  // row below, or a line in the list of kinds that have none.
  const registered = [
    [
      "packages/client/src/modules/story-world/figures/FigureNode.tsx",
      /figureNodeTypes = \{([^}]*)\}/,
    ],
    [
      "packages/client/src/modules/story-world/places/PlaceNode.tsx",
      /placeNodeTypes = \{([^}]*)\}/,
    ],
    [
      "packages/client/src/modules/storyboard/StoryboardNode.tsx",
      /storyboardNodeTypes = \{([^}]*)\}/,
    ],
    [
      "packages/client/src/modules/story-world/places/PlaceCanvas.tsx",
      /nodeTypes: \{ \.\.\.placeNodeTypes, ([^}]*) \}/,
    ],
  ].flatMap(([file, pattern]) => {
    const match = readFileSync(file as string, "utf8").match(pattern as RegExp);
    if (!match) throw new Error(`No node type registration found in ${file}.`);
    return match[1].split(",").map((entry) => entry.split(":")[0].trim());
  });
  // story: figure card (no commands, asserted below). place: place card and pin.
  // placeMap / placeGround: the map surface and its ground, drawn without commands of their own;
  // the map's commands live on its card and toolbar. storyboard: note, reference, board, group.
  expect(registered.sort()).toEqual(["place", "placeGround", "placeMap", "story", "storyboard"]);
});

test("Place: the card and the pin list their commands in the same order", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Command geometry uses the fixed wide canvas.");
  await useGermanTheme(page);
  await mockExpandedMapWorld(page);
  await openExpandedMapWorld(page);

  const node = placeNode(page, "x-graufurth");
  await node.locator(".story-node").hover();
  const card = await commandsOf(node, PLACE_ACTIONS);
  expect(actionsOf(card)).toEqual(["display", "open"]);

  await node.getByRole("button", { name: "Ort Graufurth als Stecknadel anzeigen" }).click();
  const pinNode = page.locator('.place-node-pin[data-place-id="x-graufurth"]');
  await pinNode.hover();
  const pin = await commandsOf(pinNode, PLACE_ACTIONS);
  expect(actionsOf(pin)).toEqual(["display", "open"]);

  expectSameOrder("card", card, "pin", pin, 2);
});

test("Map: the collapsed and the expanded map list their commands in the same order", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Command geometry uses the fixed wide canvas.");
  await useGermanTheme(page);
  await mockExpandedMapWorld(page, expandedMapState({ expanded: false }));
  await openExpandedMapWorld(page);

  // Collapsed: once the card is selected, the toolbar beside the canvas.
  await placeNode(page, "x-weltkarte").locator(".story-node").click();
  const toolbar = page.getByRole("toolbar", { name: "Kartenaktionen" });
  await expect(toolbar).toBeVisible();
  const collapsedToolbar = await commandsOf(toolbar, PLACE_ACTIONS);
  expect(actionsOf(collapsedToolbar)).toEqual(expect.arrayContaining(["lock", "open", "expand"]));

  // Expanded: the chrome that replaces the toolbar.
  await toolbar.getByRole("button", { name: "Weltkarte aufklappen" }).click();
  const chrome = page.locator(".place-map-chrome__actions");
  await expect(chrome).toBeVisible();
  await waitForMapViewport(page);
  const expandedChrome = await commandsOf(chrome, PLACE_ACTIONS);
  expect(actionsOf(expandedChrome)).toEqual(expect.arrayContaining(["lock", "open", "expand"]));

  expectSameOrder("collapsed toolbar", collapsedToolbar, "expanded chrome", expandedChrome, 3);
});

test("Map: the collapsed card and the toolbar list their commands in the same order", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Command geometry uses the fixed wide canvas.");
  await useGermanTheme(page);
  await mockExpandedMapWorld(page, expandedMapState({ expanded: false }));
  await openExpandedMapWorld(page);

  const mapNode = placeNode(page, "x-weltkarte");
  await mapNode.locator(".story-node").hover();
  const card = await commandsOf(mapNode, PLACE_ACTIONS);
  await mapNode.locator(".story-node").click();
  const toolbar = page.getByRole("toolbar", { name: "Kartenaktionen" });
  await expect(toolbar).toBeVisible();
  expectSameOrder(
    "collapsed card",
    card,
    "collapsed toolbar",
    await commandsOf(toolbar, PLACE_ACTIONS),
    2,
  );
});

test("Figure: the card carries no commands of its own", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Command geometry uses the fixed wide canvas.");
  const world = await createTestWorld(page, `Command order figure ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const response = await page.request.get(`/api/state?world=${worldId}`);
  const revision = Number((response.headers().etag || '"0"').replaceAll('"', ""));
  const saved = await page.request.put(`/api/state?world=${worldId}`, {
    headers: { "If-Match": `"${revision}"` },
    data: encodeStoryWorldDocument(
      { nodes: [{ id: "ada", name: "Ada", type: "person", x: 160, y: 180 }], edges: [] },
      revision,
    ),
  });
  expect(saved.ok()).toBe(true);
  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Figuren", exact: true }).click();
  const card = page.locator(".react-flow__node .story-node").filter({ hasText: "Ada" });
  await expect(card).toBeVisible();
  // Unselected and selected must agree -- today both offer none. A command added to the card
  // has to be added to this test, with its place compared, rather than slip in unobserved.
  const any: ActionTable = { any: /.*/ };
  expect(await commandsOf(card, any)).toEqual([]);
  await card.click();
  expect(await commandsOf(card, any)).toEqual([]);
});

test("Storyboard: every card lists its commands in the same order selected and not", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "wide", "Command geometry uses the fixed wide canvas.");
  const world = await createTestWorld(page, `Command order storyboard ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  const stateResponse = await page.request.get(`/api/state?world=${worldId}`);
  const stateRevision = Number((stateResponse.headers().etag || '"0"').replaceAll('"', ""));
  expect(
    (
      await page.request.put(`/api/state?world=${worldId}`, {
        headers: { "If-Match": `"${stateRevision}"` },
        data: encodeStoryWorldDocument(
          { nodes: [{ id: "ada", name: "Ada", type: "person", x: 160, y: 180 }], edges: [] },
          stateRevision,
        ),
      })
    ).ok(),
  ).toBe(true);
  const boardResponse = await page.request.get(`/api/storyboards?world=${worldId}`);
  const boardRevision = Number((boardResponse.headers().etag || '"0"').replaceAll('"', ""));
  const card = { width: 280, height: 220 };
  expect(
    (
      await page.request.put(`/api/storyboards?world=${worldId}`, {
        headers: { "If-Match": `"${boardRevision}"` },
        data: encodeStoryboardsV1(
          {
            boards: [
              { id: "main-storyboard", title: "Main Storyboard" },
              { id: "second-board", title: "Zweiter Akt" },
            ],
            nodes: [
              {
                id: "n-note",
                boardId: "main-storyboard",
                kind: "note",
                x: 40,
                y: 40,
                text: "Eine Notiz",
                ...card,
              },
              {
                id: "n-reference",
                boardId: "main-storyboard",
                kind: "reference",
                target: { kind: "entity", id: "ada" },
                label: "Ada im Garten",
                x: 360,
                y: 40,
                ...card,
              },
              {
                id: "n-board",
                boardId: "main-storyboard",
                kind: "storyboard",
                target: { kind: "storyboard", id: "second-board" },
                label: "Zweiter Akt",
                x: 680,
                y: 40,
                ...card,
              },
              {
                id: "n-group",
                boardId: "main-storyboard",
                kind: "group",
                label: "Gruppe",
                x: 40,
                y: 340,
                width: 400,
                height: 260,
              },
            ],
            edges: [],
          },
          boardRevision,
        ),
      })
    ).ok(),
  ).toBe(true);

  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();
  await page.getByRole("button", { name: "Storyboard", exact: true }).click();
  await page.getByRole("toolbar", { name: "Storyboard-Werkzeuge" }).waitFor();

  for (const kind of ["note", "reference", "storyboard", "group"]) {
    const node = page.locator(`[data-storyboard-node-kind="${kind}"]`);
    await expect(node).toBeVisible();
    // Park the pointer on empty canvas first: a card's commands may depend on hover.
    await page.mouse.move(5, 5);
    const idle = await commandsOf(node, STORYBOARD_ACTIONS);
    await node.locator(".storyboard-node__header").click();
    await expect(node).toHaveClass(/is-selected/);
    const selected = await commandsOf(node, STORYBOARD_ACTIONS);
    expect(actionsOf(selected), `${kind} offers its resize command when selected`).toContain(
      "resize",
    );
    expectSameOrder(`${kind} idle`, idle, `${kind} selected`, selected, kind === "group" ? 0 : 1);
  }
});

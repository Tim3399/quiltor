import type { Locator, Page } from "@playwright/test";
import type { FigureState } from "../../packages/client/src/modules/story-world";
import type { StoryboardState } from "../../packages/client/src/modules/storyboard";
import { encodeStoryboardsV1 } from "../../packages/client/src/platform/contracts/v1/storyboards";
import { encodeStoryWorldV1 } from "../../packages/client/src/platform/contracts/v1/storyWorld";
import { createTestWorld, expect, test } from "./support/world-fixture";

const storyWorld: FigureState = {
  nodes: [
    { id: "figure-a", x: 100, y: 100, type: "person", name: "Ada" },
    { id: "figure-b", x: 620, y: 100, type: "person", name: "Bela" },
    { id: "figure-c", x: 100, y: 400, type: "person", name: "Cora" },
    { id: "figure-d", x: 620, y: 400, type: "person", name: "Dara" },
    { id: "figure-obstacle", x: 410, y: 100, type: "person", name: "Edda" },
  ],
  edges: [
    {
      id: "figure-directed",
      from: "figure-a",
      to: "figure-b",
      label: "führt",
      active: true,
      gerichtet: true,
    },
    {
      id: "figure-undirected",
      from: "figure-a",
      to: "figure-b",
      label: "kennt",
      active: true,
      gerichtet: false,
    },
  ],
};

const storyboards: StoryboardState = {
  boards: [{ id: "main-storyboard", title: "Main Storyboard" }],
  nodes: [
    {
      id: "story-a",
      boardId: "main-storyboard",
      kind: "note",
      x: 100,
      y: 100,
      width: 220,
      height: 150,
      text: "Anfang",
    },
    {
      id: "story-b",
      boardId: "main-storyboard",
      kind: "note",
      x: 620,
      y: 100,
      width: 220,
      height: 150,
      text: "Wendung",
    },
    {
      id: "story-c",
      boardId: "main-storyboard",
      kind: "note",
      x: 100,
      y: 400,
      width: 220,
      height: 150,
      text: "Konflikt",
    },
    {
      id: "story-d",
      boardId: "main-storyboard",
      kind: "note",
      x: 620,
      y: 400,
      width: 220,
      height: 150,
      text: "Folge",
    },
    {
      id: "story-obstacle",
      boardId: "main-storyboard",
      kind: "note",
      x: 410,
      y: 100,
      width: 220,
      height: 150,
      text: "Hindernis",
    },
  ],
  edges: [
    {
      id: "story-directed",
      boardId: "main-storyboard",
      sourceNodeId: "story-a",
      targetNodeId: "story-b",
      label: "führt",
      directed: true,
    },
    {
      id: "story-undirected",
      boardId: "main-storyboard",
      sourceNodeId: "story-a",
      targetNodeId: "story-b",
      label: "kennt",
      directed: false,
    },
  ],
};

type EdgeSample = {
  directed: string;
  undirected: string;
};

async function seedVersionedDocument(
  page: Page,
  endpoint: string,
  encode: (revision: number) => object,
) {
  const initial = await page.request.get(endpoint);
  expect(initial.ok()).toBeTruthy();
  const etag = initial.headers().etag || '"0"';
  const revision = Number(etag.replaceAll('"', ""));
  const saved = await page.request.put(endpoint, {
    headers: { "If-Match": etag },
    data: encode(revision),
  });
  expect(saved.ok()).toBeTruthy();
}

async function resolvedTokenColor(page: Page, token: "--gold" | "--moss") {
  return page.evaluate((name) => {
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "path");
    probe.style.stroke = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).stroke;
    probe.remove();
    return color;
  }, token);
}

async function markerColor(page: Page, edgePath: Locator) {
  const markerEnd = await edgePath.getAttribute("marker-end");
  const markerReference = markerEnd?.trim();
  const markerId =
    markerReference?.startsWith("url(") && markerReference.endsWith(")")
      ? markerReference
          .slice(4, -1)
          .trim()
          .replace(/^['"]?#/, "")
          .replace(/['"]$/, "")
      : undefined;
  expect(markerId, "Gerichtete Kante verweist auf keinen SVG-Marker").toBeTruthy();
  return page.evaluate((id) => {
    const marker = [...document.querySelectorAll("marker")].find(
      (candidate) => candidate.id === id,
    );
    const shape = marker?.querySelector<SVGElement>("path, polygon, polyline");
    if (!shape) throw new Error(`Marker ${id} hat keine sichtbare Form`);
    const style = getComputedStyle(shape);
    return style.fill === "none" ? style.stroke : style.fill;
  }, markerId ?? "");
}

async function expectCompactLabelCard(
  surface: Locator,
  edgeId: string,
  expectedBorderColor: string,
) {
  const edge = surface.locator(`.react-flow__edge[data-id="${edgeId}"]`);
  const label = surface.locator(`.graph-edge-label[data-edge-label-id="${edgeId}"]`);
  const card = label.locator(".graph-edge-label__card");
  await expect(label).toBeVisible();
  await expect(card).toBeVisible();
  await expect(edge.locator(".graph-edge-label")).toHaveCount(0);

  const geometry = await label.evaluate((element) => {
    const card = element.querySelector<HTMLElement>(".graph-edge-label__card");
    if (!card) throw new Error("Sichtbare Kantenlabel-Card fehlt");
    const cardStyle = getComputedStyle(card);
    const cardBox = card.getBoundingClientRect();
    const hitTargetBox = element.getBoundingClientRect();
    const textBox = card
      .querySelector<HTMLElement>(".graph-edge-label__text")
      ?.getBoundingClientRect();
    const topmost = document.elementFromPoint(
      cardBox.left + cardBox.width / 2,
      cardBox.top + cardBox.height / 2,
    );
    return {
      cardBoxWidth: cardBox.width,
      cardBoxHeight: cardBox.height,
      cardCssWidth: Number.parseFloat(cardStyle.width),
      cardCssHeight: Number.parseFloat(cardStyle.height),
      hitTargetWidth: hitTargetBox.width,
      hitTargetHeight: hitTargetBox.height,
      textWidth: textBox?.width ?? 0,
      radius: Number.parseFloat(cardStyle.borderTopLeftRadius),
      borderColor: cardStyle.borderTopColor,
      isTopmost: topmost === element || element.contains(topmost),
    };
  });

  expect(geometry.cardBoxWidth).toBeGreaterThan(geometry.textWidth);
  expect(geometry.cardBoxHeight).toBeGreaterThan(0);
  expect(geometry.cardCssWidth).toBeGreaterThanOrEqual(44);
  expect(geometry.cardCssWidth).toBeLessThanOrEqual(220);
  expect(geometry.cardCssHeight).toBe(24);
  expect(geometry.hitTargetWidth + 0.5).toBeGreaterThanOrEqual(44);
  expect(geometry.hitTargetHeight + 0.5).toBeGreaterThanOrEqual(44);
  expect(geometry.radius).toBeGreaterThanOrEqual(2);
  expect(geometry.radius).toBeLessThanOrEqual(6);
  expect(geometry.borderColor).toBe(expectedBorderColor);
  expect(geometry.isTopmost).toBe(true);
}

async function expectCollisionFreePortalLabels(surface: Locator) {
  await expect(surface.locator(".graph-edge-label")).toHaveCount(2);
  await expect(
    surface.locator(
      ".react-flow__edge-text, .react-flow__edge-textbg, .react-flow__edge-textwrapper",
    ),
  ).toHaveCount(0);

  const collisions = await surface.evaluate((element) => {
    const labels = [...element.querySelectorAll<HTMLElement>(".graph-edge-label__card")].map(
      (card) => ({
        id: card.closest<HTMLElement>(".graph-edge-label")?.dataset.edgeLabelId ?? "unknown",
        box: card.getBoundingClientRect(),
      }),
    );
    const nodes = [...element.querySelectorAll<HTMLElement>(".react-flow__node")].map((node) => ({
      id: node.dataset.id ?? "unknown",
      box: node.getBoundingClientRect(),
    }));
    const overlapArea = (first: DOMRect, second: DOMRect) => {
      const width = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const height = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      return width > 0 && height > 0 ? width * height : 0;
    };
    const result: string[] = [];
    labels.forEach((label, index) => {
      for (const node of nodes) {
        if (overlapArea(label.box, node.box) > 0.25) result.push(`${label.id} ↔ node:${node.id}`);
      }
      for (const other of labels.slice(index + 1)) {
        if (overlapArea(label.box, other.box) > 0.25) result.push(`${label.id} ↔ ${other.id}`);
      }
    });
    return result;
  });

  expect(collisions).toEqual([]);
}

async function expectLabelsOnTheirRenderedEdges(surface: Locator, edgeIds: readonly string[]) {
  for (const edgeId of edgeIds) {
    const geometry = await surface.evaluate((element, id) => {
      const labelCard = element.querySelector<HTMLElement>(
        `.graph-edge-label[data-edge-label-id="${CSS.escape(id)}"] .graph-edge-label__card`,
      );
      const path = element.querySelector<SVGPathElement>(
        `.react-flow__edge[data-id="${CSS.escape(id)}"] .react-flow__edge-path`,
      );
      if (!labelCard || !path) throw new Error(`Kante oder Portal-Label fehlt: ${id}`);
      const matrix = path.getScreenCTM();
      if (!matrix) throw new Error(`Kante hat keine Bildschirmtransformation: ${id}`);

      const labelBox = labelCard.getBoundingClientRect();
      const labelCenter = {
        x: labelBox.left + labelBox.width / 2,
        y: labelBox.top + labelBox.height / 2,
      };
      const pathLength = path.getTotalLength();
      // Sample by path length rather than expected coordinates. This follows
      // straight and rounded Smooth-Step segments equally and stays stable under FitView/zoom.
      const sampleCount = Math.min(5_000, Math.max(64, Math.ceil(pathLength * 4)));
      let closestDistance = Number.POSITIVE_INFINITY;
      for (let sample = 0; sample <= sampleCount; sample += 1) {
        const point = path.getPointAtLength((pathLength * sample) / sampleCount);
        const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        closestDistance = Math.min(
          closestDistance,
          Math.hypot(screenPoint.x - labelCenter.x, screenPoint.y - labelCenter.y),
        );
      }
      return { closestDistance, pathLength };
    }, edgeId);

    expect(geometry.pathLength, `Kante ${edgeId} hat keine sichtbare Geometrie`).toBeGreaterThan(0);
    expect(
      geometry.closestDistance,
      `Kantenlabel ${edgeId} liegt nicht auf seiner eigenen gerenderten Smooth-Step-Kante`,
    ).toBeLessThanOrEqual(1.5);
  }
}

async function expectGraphEdgeContract(
  page: Page,
  surface: Locator,
  edgeIds: { directed: string; undirected: string },
  expected: EdgeSample,
) {
  const directed = surface.locator(`.react-flow__edge[data-id="${edgeIds.directed}"]`);
  const undirected = surface.locator(`.react-flow__edge[data-id="${edgeIds.undirected}"]`);
  await expect(directed).toHaveClass(/\bedge-directed\b/);
  await expect(undirected).toHaveClass(/\bedge-undirected\b/);

  const directedPath = directed.locator(".react-flow__edge-path");
  const undirectedPath = undirected.locator(".react-flow__edge-path");
  await expect(directedPath).toHaveCSS("stroke", expected.directed);
  await expect(undirectedPath).toHaveCSS("stroke", expected.undirected);
  await expect(directedPath).toHaveAttribute("marker-end", /url\(['"]?#/);
  await expect(undirectedPath).not.toHaveAttribute("marker-end", /url\(/);
  expect(await markerColor(page, directedPath)).toBe(expected.directed);

  await expectCompactLabelCard(surface, edgeIds.directed, expected.directed);
  await expectCompactLabelCard(surface, edgeIds.undirected, expected.undirected);
  await expectCollisionFreePortalLabels(surface);
  await expectLabelsOnTheirRenderedEdges(surface, [edgeIds.directed, edgeIds.undirected]);

  await surface.locator(`.graph-edge-label[data-edge-label-id="${edgeIds.directed}"]`).click();
  await expect(directed).toHaveClass(/\bselected\b/);
  await expect(directedPath).toHaveCSS("stroke", expected.directed);
  await expectCompactLabelCard(surface, edgeIds.directed, expected.directed);

  await surface.locator(`.graph-edge-label[data-edge-label-id="${edgeIds.undirected}"]`).click();
  await expect(undirected).toHaveClass(/\bselected\b/);
  await expect(undirectedPath).toHaveCSS("stroke", expected.undirected);
  await expectCompactLabelCard(surface, edgeIds.undirected, expected.undirected);
  await expectCollisionFreePortalLabels(surface);
  await expectLabelsOnTheirRenderedEdges(surface, [edgeIds.directed, edgeIds.undirected]);
}

test("Figuren und Storyboard teilen Richtungsfarben, Marker und kompakte Kantenlabels", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "wide",
    "Graph-Geometrie und Pointer-Auswahl werden einmal im stabilen Desktop-Viewport geprüft.",
  );

  const world = await createTestWorld(page, `Kantenstil ${crypto.randomUUID()}`);
  const worldId = encodeURIComponent(world.id);
  await seedVersionedDocument(page, `/api/state?world=${worldId}`, (revision) =>
    encodeStoryWorldV1(storyWorld, revision),
  );
  await seedVersionedDocument(page, `/api/storyboards?world=${worldId}`, (revision) =>
    encodeStoryboardsV1(storyboards, revision),
  );

  await page.goto(`/?world=${worldId}`);
  await page.getByRole("toolbar", { name: "Manuskript" }).waitFor();

  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((selectedTheme) => {
      localStorage.setItem("quiltor-theme", selectedTheme);
      document.documentElement.dataset.theme = selectedTheme;
      document.documentElement.style.colorScheme = selectedTheme;
    }, theme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const expected = {
      directed: await resolvedTokenColor(page, "--gold"),
      undirected: await resolvedTokenColor(page, "--moss"),
    };
    expect(expected.directed).not.toBe(expected.undirected);

    await page.getByRole("button", { name: "Storyboard", exact: true }).click();
    const storyboard = page.locator(".storyboard-flow.graph-edge-surface");
    await expectGraphEdgeContract(
      page,
      storyboard,
      { directed: "story-directed", undirected: "story-undirected" },
      expected,
    );

    await page.getByRole("button", { name: "Figuren", exact: true }).click();
    const figures = page.locator(".figure-workspace .graph-edge-surface");
    await expectGraphEdgeContract(
      page,
      figures,
      { directed: "figure-directed", undirected: "figure-undirected" },
      expected,
    );
  }
});

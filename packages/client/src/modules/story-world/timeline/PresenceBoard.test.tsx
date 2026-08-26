import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import type { FigureNode, PresenceEntry, TimelineMoment } from "../model";
import { PresenceBoard } from "./PresenceBoard";

afterEach(cleanup);

const timeline: TimelineMoment[] = [{ id: "m1", title: "Erster Zeitpunkt" }];
const ada: FigureNode = { id: "ada", x: 0, y: 0, name: "Ada", type: "person" };
const arcene: FigureNode = { id: "arcene", x: 0, y: 0, name: "Arcène", type: "ort" };
const hafen: FigureNode = { id: "hafen", x: 0, y: 0, name: "Hafen", type: "ort" };

function renderBoard(props: React.ComponentProps<typeof PresenceBoard>) {
  return render(
    <I18nProvider>
      <PresenceBoard {...props} />
    </I18nProvider>,
  );
}

function makeDataTransfer(nodeId: string) {
  return { setData: vi.fn(), getData: () => nodeId };
}

function chip(name: string) {
  return screen.getByText(name, { selector: "strong" }).closest("button") as HTMLButtonElement;
}

function lane(name: string) {
  return screen
    .getByText(name, { selector: ".presence-lane-heading" })
    .closest(".presence-lane") as HTMLButtonElement;
}

describe("PresenceBoard", () => {
  it("assigns a place when a character chip is dragged onto a lane", () => {
    const onPatch = vi.fn();
    renderBoard({
      nodes: [ada],
      places: [arcene, hafen],
      presence: [],
      timeline,
      momentId: "m1",
      onPatch,
    });
    const dataTransfer = makeDataTransfer("ada");
    fireEvent.dragStart(chip("Ada"), { dataTransfer });
    fireEvent.dragOver(lane("Hafen"), { dataTransfer });
    fireEvent.drop(lane("Hafen"), { dataTransfer });
    expect(onPatch).toHaveBeenCalledWith("ada", "hafen");
  });

  it("assigns a place via the click-click accessibility fallback", () => {
    const onPatch = vi.fn();
    renderBoard({
      nodes: [ada],
      places: [arcene, hafen],
      presence: [],
      timeline,
      momentId: "m1",
      onPatch,
    });
    fireEvent.click(chip("Ada"));
    fireEvent.click(lane("Arcène"));
    expect(onPatch).toHaveBeenCalledWith("ada", "arcene");
  });

  it("deselects a chip when clicked twice, without assigning it anywhere", () => {
    const onPatch = vi.fn();
    renderBoard({
      nodes: [ada],
      places: [arcene, hafen],
      presence: [],
      timeline,
      momentId: "m1",
      onPatch,
    });
    const adaChip = chip("Ada");
    fireEvent.click(adaChip);
    fireEvent.click(adaChip);
    expect(adaChip).not.toHaveClass("selected");
    fireEvent.click(lane("Arcène"));
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('clears the assignment when dropped on the "Unverändert" lane', () => {
    const onPatch = vi.fn();
    const presence: PresenceEntry[] = [
      { id: "p1", elementId: "ada", placeId: "hafen", momentId: "m1" },
    ];
    renderBoard({
      nodes: [ada],
      places: [arcene, hafen],
      presence,
      timeline,
      momentId: "m1",
      onPatch,
    });
    const dataTransfer = makeDataTransfer("ada");
    fireEvent.dragStart(chip("Ada"), { dataTransfer });
    fireEvent.drop(lane("Unverändert / kein Ort"), { dataTransfer });
    expect(onPatch).toHaveBeenCalledWith("ada", "");
  });

  it("shows an inherited indicator when a character has no explicit override this moment", () => {
    const before: TimelineMoment = { id: "before", title: "Vorher" };
    const twoMoments = [before, timeline[0]];
    const presence: PresenceEntry[] = [{ id: "p1", elementId: "ada", placeId: "arcene" }];
    renderBoard({
      nodes: [ada],
      places: [arcene, hafen],
      presence,
      timeline: twoMoments,
      momentId: "m1",
      onPatch: vi.fn(),
    });
    expect(screen.getByText(/geerbt · Arcène/)).toBeInTheDocument();
  });

  it("lists an occupant chip inside the lane matching their explicit override", () => {
    const presence: PresenceEntry[] = [
      { id: "p1", elementId: "ada", placeId: "hafen", momentId: "m1" },
    ];
    renderBoard({
      nodes: [ada],
      places: [arcene, hafen],
      presence,
      timeline,
      momentId: "m1",
      onPatch: vi.fn(),
    });
    expect(lane("Hafen").querySelector(".presence-chip-mini")).toHaveTextContent("Ada");
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabPanel } from "../Tabs";
import {
  DETAIL_COMPACT_QUERY,
  DetailPanel,
  DetailPanelBody,
  DetailPanelDeleteButton,
  DetailPanelFooter,
  DetailPanelTabs,
} from "./DetailPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
}

function Figure({
  compact,
  onDelete = () => undefined,
}: {
  compact?: boolean;
  onDelete?: () => void;
}) {
  const [tab, setTab] = useState("card");
  return (
    <DetailPanel
      label="Figuren-Inspector"
      open
      compact={compact}
      eyebrow="Figur"
      title="Mara Lind"
      closeLabel="Auswahl schließen"
      onClose={() => undefined}
    >
      <DetailPanelTabs
        label="Inspector"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "card", label: "Karte" },
          { value: "relations", label: "Beziehungen" },
        ]}
      >
        <DetailPanelBody>
          <TabPanel value="card">
            <button type="button">Name bearbeiten</button>
          </TabPanel>
          <TabPanel value="relations">Keine Beziehungen</TabPanel>
        </DetailPanelBody>
      </DetailPanelTabs>
      <DetailPanelFooter>
        <DetailPanelDeleteButton label="Figur löschen" onClick={onDelete} />
      </DetailPanelFooter>
    </DetailPanel>
  );
}

describe("DetailPanel", () => {
  it("names the element in its header and ends with the delete button on every tab", () => {
    const remove = vi.fn();
    render(<Figure compact={false} onDelete={remove} />);
    const panel = screen.getByRole("complementary", { name: "Figuren-Inspector" });
    expect(panel).toHaveAttribute("data-presentation", "docked");
    expect(screen.getByRole("heading", { name: "Mara Lind" })).toBeVisible();
    expect(screen.getByText("Figur")).toBeVisible();
    expect(screen.getByRole("button", { name: "Auswahl schließen" })).toBeVisible();
    const deleteButton = screen.getByRole("button", { name: "Figur löschen" });
    expect(focusables(panel).at(-1)).toBe(deleteButton);
    expect(deleteButton).toHaveAttribute("data-delete-scope", "element");
    fireEvent.click(screen.getByRole("tab", { name: "Beziehungen" }));
    expect(focusables(panel).at(-1)).toBe(screen.getByRole("button", { name: "Figur löschen" }));
    fireEvent.click(screen.getByRole("button", { name: "Figur löschen" }));
    expect(remove).toHaveBeenCalledOnce();
  });

  it("is a non-modal drawer on compact: complementary, no dialog, the page stays usable", () => {
    render(
      <>
        <button type="button">Karte auf dem Board</button>
        <Figure compact />
      </>,
    );
    const panel = screen.getByRole("complementary", { name: "Figuren-Inspector" });
    expect(panel).toHaveAttribute("data-presentation", "drawer");
    expect(panel).not.toHaveAttribute("aria-modal");
    expect(screen.queryByRole("dialog")).toBeNull();
    const board = screen.getByRole("button", { name: "Karte auf dem Board" });
    expect(board.closest("[inert]")).toBeNull();
    board.focus();
    expect(board).toHaveFocus();
  });

  it("follows the 820px query when the host does not decide", () => {
    const queries: string[] = [];
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => {
        queries.push(query);
        return { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
      }),
    );
    render(<Figure />);
    expect(DETAIL_COMPACT_QUERY).toBe("(max-width: 820px)");
    expect(queries).toContain("(max-width: 820px)");
    expect(screen.getByRole("complementary")).toHaveAttribute("data-presentation", "drawer");
  });

  it("shows the empty state while docked and closed, and nothing as a closed drawer", () => {
    const props = {
      label: "Orte-Inspector",
      open: false,
      closeLabel: "Auswahl schließen",
      onClose: () => undefined,
      empty: <p>Ort auswählen</p>,
    };
    const { rerender } = render(<DetailPanel {...props} compact={false} />);
    expect(screen.getByRole("complementary", { name: "Orte-Inspector" })).toHaveAttribute(
      "data-state",
      "empty",
    );
    expect(screen.getByText("Ort auswählen")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Auswahl schließen" })).toBeNull();
    rerender(<DetailPanel {...props} compact />);
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("closes with Escape and with the close button and returns focus to the host", () => {
    const close = vi.fn();
    const back = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={back} type="button">
          Zeitpunkt im Board
        </button>
        <DetailPanel
          label="Zeitpunkt"
          open
          compact
          title="Sturmnacht"
          closeLabel="Schließen"
          onClose={close}
          returnFocusRef={back}
        >
          <DetailPanelBody>
            <input aria-label="Titel" />
          </DetailPanelBody>
        </DetailPanel>
      </>,
    );
    const field = screen.getByRole("textbox", { name: "Titel" });
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    expect(back.current).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("leaves an Escape that the content already handled alone", () => {
    const close = vi.fn();
    render(
      <DetailPanel label="Ort" open compact title="Hafen" closeLabel="Schließen" onClose={close}>
        <input
          aria-label="Name"
          onKeyDown={(event) => {
            if (event.key === "Escape") event.preventDefault();
          }}
        />
      </DetailPanel>,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });

  it("keeps a blocked delete visible and says why", () => {
    render(
      <DetailPanelDeleteButton
        label="Zeitpunkt löschen"
        disabled
        disabledReason="Zwei Kapitel spielen zu diesem Zeitpunkt."
        onClick={() => undefined}
      />,
    );
    const button = screen.getByRole("button", { name: "Zeitpunkt löschen" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Zwei Kapitel spielen zu diesem Zeitpunkt.");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../../i18n";
import type { ModelState, ModelStore } from "./modelStore";
import { createWebllmPanel } from "./WebllmPanel";

function storeIn(state: ModelState): ModelStore {
  return {
    getState: () => state,
    subscribe: () => () => {},
    refresh: vi.fn(async () => {}),
    download: vi.fn(async () => {}),
    engine: vi.fn(async () => null),
    discard: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
}

function renderPanel(store: ModelStore) {
  const Panel = createWebllmPanel(store);
  return render(
    <I18nProvider>
      <Panel />
    </I18nProvider>,
  );
}

describe("WebLLM panel (T-61 part 7)", () => {
  it("offers the download while the model is not on this device", () => {
    const store = storeIn({ phase: "absent" });
    renderPanel(store);
    expect(store.refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Modell herunterladen" }));
    expect(store.download).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Modell entfernen" })).not.toBeInTheDocument();
  });

  it("shows the download's progress", () => {
    renderPanel(storeIn({ phase: "downloading", progress: 0.42 }));
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("shows a loaded model as a quiet status line, not a box (T-275-F6)", () => {
    const { container } = renderPanel(storeIn({ phase: "ready" }));
    expect(container.querySelector(".ui-alert, .webllm-panel")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Im Browser · geladen")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modell entfernen" })).not.toBeInTheDocument();
  });

  it("removes a loaded model from the overflow menu", () => {
    const store = storeIn({ phase: "ready" });
    renderPanel(store);
    fireEvent.click(screen.getByRole("button", { name: "Modell-Aktionen" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Modell entfernen" }));
    expect(store.remove).toHaveBeenCalled();
  });

  it("keeps the box for states that ask for action", () => {
    for (const state of [
      { phase: "absent" },
      { phase: "downloading", progress: 0.1 },
      { phase: "error", message: "x" },
      { phase: "cached" },
    ] as ModelState[]) {
      const { container, unmount } = renderPanel(storeIn(state));
      expect(container.querySelector(".webllm-panel")).not.toBeNull();
      expect(screen.getByText("KI im Browser")).toBeInTheDocument();
      unmount();
    }
  });

  it("offers the remove button for a model on disk that is not loaded", () => {
    renderPanel(storeIn({ phase: "cached" }));
    expect(screen.getByRole("button", { name: "Modell entfernen" })).toBeInTheDocument();
  });
});

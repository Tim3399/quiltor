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
    remove: vi.fn(async () => {}),
  };
}

function renderPanel(store: ModelStore) {
  const Panel = createWebllmPanel(store);
  render(
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

  it("removes a loaded model", () => {
    const store = storeIn({ phase: "ready" });
    renderPanel(store);
    fireEvent.click(screen.getByRole("button", { name: "Modell entfernen" }));
    expect(store.remove).toHaveBeenCalled();
  });

  it("offers the remove button for a model on disk that is not loaded", () => {
    renderPanel(storeIn({ phase: "cached" }));
    expect(screen.getByRole("button", { name: "Modell entfernen" })).toBeInTheDocument();
  });
});

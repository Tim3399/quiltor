import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { WorldGate } from "./WorldGate";

afterEach(cleanup);

describe("WorldGate", () => {
  it("opens creation as a separate sheet and creates only after submission", () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nProvider>
        <WorldGate
          worlds={[]}
          theme="system"
          onTheme={vi.fn()}
          onOpen={vi.fn()}
          onCreate={onCreate}
          onDelete={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "Neue Welt" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Neue Welt" }));
    expect(screen.getByRole("dialog", { name: "Neue Welt" })).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Der letzte Garten"), {
      target: { value: "Testwelt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Welt erstellen" }));
    expect(onCreate).toHaveBeenCalledWith("Testwelt", "");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListboxSelect } from "./ListboxSelect";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta", disabled: true },
  { value: "g", label: "Gamma" },
] as const;

describe("ListboxSelect", () => {
  it("opens a labelled listbox and focuses the current option", async () => {
    render(
      <ListboxSelect label="Auswahl" value="g" options={options} onChange={() => undefined} />,
    );
    const trigger = screen.getByRole("combobox", { name: "Auswahl" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "Auswahl" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("option", { name: "Gamma" })).toHaveFocus());
  });

  it("moves across enabled options and selects one", async () => {
    const change = vi.fn();
    render(<ListboxSelect label="Auswahl" value="a" options={options} onChange={change} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Auswahl" }));
    const alpha = screen.getByRole("option", { name: "Alpha" });
    await waitFor(() => expect(alpha).toHaveFocus());
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    const gamma = screen.getByRole("option", { name: "Gamma" });
    expect(gamma).toHaveFocus();
    fireEvent.click(gamma);
    expect(change).toHaveBeenCalledWith("g");
    expect(screen.queryByRole("listbox", { name: "Auswahl" })).toBeNull();
  });

  it("does not open while disabled", () => {
    render(
      <ListboxSelect
        label="Auswahl"
        value="a"
        options={options}
        onChange={() => undefined}
        disabled
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Auswahl" });
    fireEvent.click(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("falls back to the first enabled option when the selected option is disabled", async () => {
    render(
      <ListboxSelect label="Auswahl" value="b" options={options} onChange={() => undefined} />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Auswahl" }));

    const disabledSelection = screen.getByRole("option", { name: "Beta" });
    expect(disabledSelection).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(screen.getByRole("option", { name: "Alpha" })).toHaveFocus());
  });

  it("marks and focuses the selected option when its popover adapts to a compact sheet", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    render(
      <ListboxSelect
        label="Auswahl"
        value="g"
        options={options}
        onChange={() => undefined}
        size="touch"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Auswahl" }));

    expect(screen.getByRole("dialog", { name: "Auswahl" })).toBeInTheDocument();
    const gamma = screen.getByRole("option", { name: "Gamma" });
    expect(gamma).toHaveAttribute("data-autofocus", "true");
    await waitFor(() => expect(gamma).toHaveFocus());
  });

  it("keeps long labels inside the trigger without displacing its chevron", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/design/components/ListboxSelect/ListboxSelect.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.ui-select-control > \.ui-select-option__content\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(css).toMatch(
      /\.ui-select-option__label\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s,
    );
    expect(css).toMatch(/\.ui-select-control svg\s*\{[^}]*flex:\s*none;/s);
  });

  it("renders caller-owned decorative leading content without changing accessible names", () => {
    const decoratedOptions = [
      {
        value: "a",
        label: "Alpha",
        leading: <span aria-hidden="true" data-testid="alpha-swatch" />,
      },
      { value: "g", label: "Gamma" },
    ] as const;
    render(
      <ListboxSelect
        label="Auswahl"
        value="a"
        options={decoratedOptions}
        onChange={() => undefined}
      />,
    );

    const trigger = screen.getByRole("combobox", { name: "Auswahl" });
    expect(trigger).toHaveAccessibleName("Auswahl");
    expect(screen.getByTestId("alpha-swatch")).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(trigger);

    const option = screen.getByRole("option", { name: "Alpha" });
    expect(option.querySelector('[data-testid="alpha-swatch"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("promotes compact triggers and options to touch targets on narrow or coarse pointers", () => {
    const css = readFileSync(
      join(process.cwd(), "packages/client/src/design/components/ListboxSelect/ListboxSelect.css"),
      "utf8",
    );

    expect(css).toMatch(
      /@media \(max-width: 719px\), \(pointer: coarse\)\s*\{[^}]*\.ui-select-control\[data-size="compact"\],[^}]*\.ui-select-listbox \[role="option"\][^{]*\{[^}]*min-height:\s*var\(--control-touch\);/s,
    );
  });
});

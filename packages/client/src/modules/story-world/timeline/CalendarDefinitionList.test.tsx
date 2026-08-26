import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalendarDefinitionList } from "./CalendarDefinitionList";

afterEach(cleanup);

describe("CalendarDefinitionList", () => {
  it("owns field, add-count and remove interactions", () => {
    const onNameChange = vi.fn();
    const onCountChange = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    render(
      <CalendarDefinitionList
        legend="Months"
        items={[{ name: "Dawn" }]}
        itemKey={(item) => item.name}
        columns={[
          {
            heading: "Name",
            field: (item) => ({
              label: "Month name",
              labelHidden: true,
              value: item.name,
              onChange: onNameChange,
            }),
          },
        ]}
        count={2}
        countLabel="Month count"
        addLabel="Add months"
        removeLabel={(item) => `Remove ${item.name}`}
        onCountChange={onCountChange}
        onAdd={onAdd}
        onRemove={onRemove}
      />,
    );

    const add = screen.getByRole("button", { name: "Add months" });
    const remove = screen.getByRole("button", { name: "Remove Dawn" });
    expect(add).toHaveAttribute("data-size", "regular");
    expect(remove).toHaveAttribute("data-size", "regular");

    fireEvent.change(screen.getByRole("spinbutton", { name: "Month count" }), {
      target: { value: "3" },
    });
    fireEvent.click(add);
    fireEvent.click(remove);

    expect(onCountChange).toHaveBeenCalledWith(3);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});

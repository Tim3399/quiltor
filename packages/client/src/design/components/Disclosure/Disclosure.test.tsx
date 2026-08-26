import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Disclosure } from "./Disclosure";

afterEach(cleanup);

describe("Disclosure", () => {
  it("uses the native details and summary contract", () => {
    const { container } = render(<Disclosure summary="Chronik">Historischer Inhalt</Disclosure>);
    const details = container.querySelector("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Chronik"));
    expect(details).toHaveAttribute("open");
  });

  it("supports an initially open disclosure", () => {
    const { container } = render(
      <Disclosure summary="Details" open>
        Inhalt
      </Disclosure>,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});

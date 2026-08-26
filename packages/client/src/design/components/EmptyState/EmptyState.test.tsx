import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "../../primitives/Button";
import { EmptyState } from "./EmptyState";

afterEach(cleanup);

describe("EmptyState", () => {
  it("provides heading, explanation and independent actions", () => {
    render(
      <EmptyState title="Noch keine Kapitel" actions={<Button>Kapitel anlegen</Button>}>
        Beginne mit dem ersten Kapitel.
      </EmptyState>,
    );
    expect(screen.getByRole("heading", { name: "Noch keine Kapitel", level: 2 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Kapitel anlegen" })).toBeEnabled();
  });
});

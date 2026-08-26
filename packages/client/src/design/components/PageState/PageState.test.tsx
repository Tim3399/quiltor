import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PageState } from "./PageState";

afterEach(cleanup);

describe("PageState", () => {
  it("marks loading pages busy and announces their copy", () => {
    render(
      <PageState kind="loading" mark="Q">
        Werkstatt wird geöffnet.
      </PageState>,
    );
    const page = screen.getByRole("main");
    expect(page).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Werkstatt wird geöffnet.");
  });

  it("announces an error copy while preserving the main page landmark", () => {
    render(
      <PageState kind="error" title="Nicht erreichbar">
        Prüfe die Verbindung.
      </PageState>,
    );
    expect(screen.getByRole("heading", { name: "Nicht erreichbar", level: 1 })).toBeVisible();
    expect(screen.getByRole("main")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Prüfe die Verbindung.");
  });
});

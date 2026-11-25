import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplicationGatewayError, BOOK_PDF_TIMEOUT_CODE, quiltorClient } from "../../platform";
import { figures, manuscript, renderWorkspace } from "./TextWorkspace.testSupport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function exportBookPdf() {
  renderWorkspace({
    manuscript,
    figures,
    onChange: vi.fn(),
    focus: false,
    onFocus: vi.fn(),
    viewportMode: "wide",
  });
  fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Buch-PDF" }));
}

describe("TextWorkspace book PDF that does not finish (T-370)", () => {
  it("says the PDF did not finish in time and stops loading after the client limit", async () => {
    vi.spyOn(quiltorClient.application.documents, "bookPdf").mockRejectedValue(
      new ApplicationGatewayError("The book PDF did not finish in time.", BOOK_PDF_TIMEOUT_CODE),
    );

    await exportBookPdf();

    expect(await screen.findByText(/Das Buch-PDF wurde nicht rechtzeitig fertig/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Weitere Aktionen" }));
    const item = await screen.findByRole("menuitem", { name: "Buch-PDF" });
    expect(item).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("menuitem", { name: "Erzeuge PDF …" })).not.toBeInTheDocument();
  });

  it("says the same when the server itself reports the render timed out", async () => {
    vi.spyOn(quiltorClient.application.documents, "bookPdf").mockRejectedValue(
      new ApplicationGatewayError("render failed", "pdf.render_failed", {
        params: { category: "timeout" },
      }),
    );

    await exportBookPdf();

    await waitFor(() =>
      expect(screen.getByText(/Das Buch-PDF wurde nicht rechtzeitig fertig/)).toBeVisible(),
    );
  });
});

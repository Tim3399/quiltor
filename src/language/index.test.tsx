import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { interfaceLanguageStorageKey, LanguageProvider, useLanguage } from "./index";

function LanguageProbe() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <>
      <button onClick={() => setLanguage(language === "de" ? "en" : "de")}>
        {t("languageChoice")}
      </button>
      <article data-testid="manuscript-content">Eigener Romantext bleibt unverändert.</article>
    </>
  );
}

describe("interface language", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("migrates the former preference without treating it as a writing language", async () => {
    localStorage.setItem("writer-language", "en");
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );

    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
    await waitFor(() => expect(localStorage.getItem(interfaceLanguageStorageKey)).toBe("en"));
    expect(localStorage.getItem("writer-language")).toBeNull();
  });

  it("changes explicit UI messages but never manuscript content", () => {
    render(
      <LanguageProvider>
        <LanguageProbe />
      </LanguageProvider>,
    );
    const content = screen.getByTestId("manuscript-content");

    fireEvent.click(screen.getByRole("button", { name: "Sprache" }));

    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
    expect(content).toHaveTextContent("Eigener Romantext bleibt unverändert.");
  });
});

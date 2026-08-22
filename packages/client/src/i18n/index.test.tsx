import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { quiltorClient } from "../platform";
import { I18nProvider, uiLocaleStorageKey, useI18n } from "./index";

function LanguageProbe() {
  const { locale, setLocale, t } = useI18n();
  return (
    <>
      <button onClick={() => setLocale(locale === "de" ? "en" : "de")}>
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
    quiltorClient.platform.preferences.set("writer-language", "en");
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    );

    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
    await waitFor(() =>
      expect(quiltorClient.platform.preferences.get(uiLocaleStorageKey)).toBe("en"),
    );
    expect(quiltorClient.platform.preferences.get("writer-language")).toBeNull();
  });

  it("changes explicit UI messages but never manuscript content", () => {
    render(
      <I18nProvider>
        <LanguageProbe />
      </I18nProvider>,
    );
    const content = screen.getByTestId("manuscript-content");

    fireEvent.click(screen.getByRole("button", { name: "Sprache" }));

    expect(screen.getByRole("button", { name: "Language" })).toBeInTheDocument();
    expect(content).toHaveTextContent("Eigener Romantext bleibt unverändert.");
  });
});

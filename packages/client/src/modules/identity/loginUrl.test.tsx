import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, uiLocaleStorageKey } from "../../i18n";
import { quiltorClient } from "../../platform";
import { loginUrl } from "./loginUrl";
import { SignInGate } from "./SignInGate";

describe("login URL", () => {
  it("names a known interface language for the provider", () => {
    expect(loginUrl("de")).toBe("/login?ui_locales=de");
    expect(loginUrl("en")).toBe("/login?ui_locales=en");
  });

  it("stays the bare login for an unknown or missing language", () => {
    expect(loginUrl("xx")).toBe("/login");
    expect(loginUrl("")).toBe("/login");
    expect(loginUrl(null)).toBe("/login");
    expect(loginUrl(undefined)).toBe("/login");
  });
});

describe("sign-in gate", () => {
  const original = window.location;
  let target: { href: string };

  beforeEach(() => {
    localStorage.clear();
    target = { href: "" };
    Object.defineProperty(window, "location", { configurable: true, value: target });
  });
  afterEach(() => {
    cleanup();
    Object.defineProperty(window, "location", { configurable: true, value: original });
  });

  it("sends the active interface language along to the login", () => {
    quiltorClient.platform.preferences.set(uiLocaleStorageKey, "en");
    render(
      <I18nProvider>
        <SignInGate authError={null} />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Keycloak" }));
    expect(target.href).toBe("/login?ui_locales=en");
  });
});

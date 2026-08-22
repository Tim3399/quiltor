import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { PRODUCT_NAME } from "../config/branding";
import { quiltorClient } from "../platform";
import {
  availableLocales,
  defaultUiLocale,
  isUiLocale,
  localeManifest,
  messageCatalog,
  messageCatalogs,
  type MessageKey,
  type UiLocale,
} from "./catalogs";

export type { LocaleManifest, MessageCatalog, MessageKey, UiLocale } from "./catalogs";
export {
  availableLocales,
  defaultUiLocale,
  isUiLocale,
  localeManifest,
  messageCatalog,
  messageCatalogs,
} from "./catalogs";

export const uiLocaleStorageKey = "quiltor-interface-language";
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const I18nContext = createContext<{
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: Translate;
} | null>(null);

function translate(locale: UiLocale, key: MessageKey, params?: Record<string, string | number>) {
  const message = messageCatalog(locale)[key];
  if (!params) return message;
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    message,
  );
}

export function readUiLocale(): UiLocale {
  const preferences = quiltorClient.platform.preferences;
  const stored = preferences.get(uiLocaleStorageKey) ?? preferences.get("writer-language");
  return isUiLocale(stored) ? stored : defaultUiLocale;
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<UiLocale>(readUiLocale);
  useEffect(() => {
    const preferences = quiltorClient.platform.preferences;
    preferences.set(uiLocaleStorageKey, locale);
    preferences.remove("writer-language");
    const manifest = localeManifest(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = manifest.direction;
    document.title = `${PRODUCT_NAME} · ${messageCatalog(locale).authorWorkshop}`;
  }, [locale]);
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: (key: MessageKey, params?: Record<string, string | number>) =>
        translate(locale, key, params),
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

export function translateUiMessage(
  locale: UiLocale,
  key: MessageKey,
  params?: Record<string, string | number>,
) {
  return translate(locale, key, params);
}

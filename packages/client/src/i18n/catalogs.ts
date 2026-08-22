import { defaultLocaleCatalog as de, localePackages } from "../../../../locales";

export type MessageKey = keyof typeof de;
export type MessageCatalog = Record<MessageKey, string>;
export type UiLocale = string;
export type LocaleDirection = "ltr" | "rtl";
export type LocaleManifest = {
  locale: UiLocale;
  name: string;
  direction: LocaleDirection;
};

export const messageCatalogs = Object.fromEntries(
  localePackages.map(({ manifest, catalog }) => [manifest.locale, catalog]),
) as Record<UiLocale, MessageCatalog>;

export const availableLocales = localePackages
  .map(({ manifest }) => ({ ...manifest }) as LocaleManifest)
  .filter((manifest) => Boolean(messageCatalogs[manifest.locale]))
  .sort((left, right) => left.name.localeCompare(right.name));

export const defaultUiLocale: UiLocale = "de";

export function isUiLocale(value: string | null | undefined): value is UiLocale {
  return Boolean(value && messageCatalogs[value]);
}

export function localeManifest(locale: UiLocale): LocaleManifest {
  return (
    availableLocales.find((candidate) => candidate.locale === locale) ?? {
      locale: defaultUiLocale,
      name: "Deutsch",
      direction: "ltr",
    }
  );
}

export function messageCatalog(locale: UiLocale): MessageCatalog {
  return messageCatalogs[locale] ?? messageCatalogs[defaultUiLocale] ?? (de as MessageCatalog);
}

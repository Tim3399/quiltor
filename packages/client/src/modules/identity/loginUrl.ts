import { isUiLocale, type UiLocale } from "../../i18n/catalogs";

// The provider's login page picks its language from `ui_locales` (OIDC), and
// Keycloak stores that language on an account it registers -- every later
// mail goes out in it. The server forwards only the languages it knows (T-175).
export function loginUrl(locale: UiLocale | null | undefined): string {
  return isUiLocale(locale) ? `/login?ui_locales=${encodeURIComponent(locale)}` : "/login";
}

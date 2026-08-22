import { messageCatalog, readUiLocale } from "../../i18n";

export function currentUiLocale() {
  return readUiLocale();
}

export function currentMessages() {
  return messageCatalog(currentUiLocale());
}

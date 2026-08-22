import de from "./de";
import deManifest from "./de/manifest.json";
import en from "./en";
import enManifest from "./en/manifest.json";

/** Explicit locale package registry: a translation MR adds its folder and one entry here. */
export const localePackages = [
  { manifest: deManifest, catalog: de },
  { manifest: enManifest, catalog: en },
] as const;

export const defaultLocaleCatalog = de;

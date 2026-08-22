# ADR 0004: Contributor-facing locale packs

Status: accepted

## Decision

Application translation resources live in the repository-root `locales/`
directory. The client localisation runtime lives separately under `i18n`.
The repository-root `locales/index.ts` is the single explicit locale registry;
adding a pack requires one catalog import and one `localePackages` entry there,
not a hidden client-package edit. The i18n gate enforces exact directory-to-registry
parity and checks files, keys and placeholders.

Writing locale, linguistic resources, assistant response language, installer
copy and store listing metadata do not share this namespace.

## Consequences

- Adding Spanish changes its locale directory plus the adjacent root registry,
  but no product-module or UI code.
- Domain types use `WritingLocale`; UI localisation uses `UiLocale`.
- Backend errors cross the boundary as stable codes and structured parameters,
  not translated prose.

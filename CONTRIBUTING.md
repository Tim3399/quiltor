# Contributing to Quiltor

## Add an interface translation

Translation packs deliberately live in the top-level [`locales/`](locales/) directory so a
translator does not need to understand the application architecture.

To contribute Spanish, for example:

1. Copy `locales/en/` to `locales/es/`.
2. Set `locale` to `es`, `name` to `Español`, and `direction` to `ltr` in
   `locales/es/manifest.json`.
3. Translate the string values in the topic files. Do not rename keys or placeholders such as
   `{count}`.
4. In the prominent root [`locales/index.ts`](locales/index.ts), add one catalog import and its
   `localePackages` entry.
5. Run `npm run check:i18n` and `npm test`.

The root registry is the only TypeScript file a translation merge request touches; no hidden
client-package or UI change is required. The i18n check enforces exact parity between locale
directories and registry entries, compares every registered pack with the German base catalog,
and rejects missing files, keys, changed placeholders, invalid BCP 47 tags, duplicate keys, and
incomplete manifests.

See [`locales/README.md`](locales/README.md) for the catalog layout and naming rules.

## Before opening a merge request

Run the same frontend gates as the release build:

```bash
npm run build
npm test
```

Keep product modules independent from browser and native globals. Persistent preferences,
clipboard access, external links, native file dialogs, and desktop bridges belong behind the
contracts in `packages/client/src/platform/`; `npm run check:platform` enforces that boundary.

Frontend product code belongs below `packages/client/src/modules/`. Other product modules may be
used only through their public `index.ts`; app composition may wire modules together. Shared,
domain-neutral code belongs in `shared/`, while HTTP and host integration stay in `platform/`.
`node tools/quality/check_architecture.mjs` checks these boundaries and rejects the retired
`features/`, `hooks/`, `lib/`, and root `types.ts` collection points.

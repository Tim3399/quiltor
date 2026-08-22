# Quiltor interface translations

Each child directory is one complete UI locale. The deliberately visible root
[`locales/index.ts`](index.ts) registers the packs loaded by the frontend.
Directory names and `manifest.json.locale` use canonical BCP 47 tags, for example `de`, `en`,
`es`, or `pt-BR`.

```text
locales/
├── de/                    German base catalog
│   ├── manifest.json
│   ├── index.ts
│   ├── common.ts
│   └── … topic catalogs
└── en/
    └── … the same files and message keys
```

`manifest.json` contains the label users see in the locale picker:

```json
{
  "locale": "es",
  "name": "Español",
  "direction": "ltr"
}
```

Translate values only. Message keys and placeholders are application contracts:

```ts
export const common = {
  ready: "Listo",
  searchMatchCount: "{count} coincidencias en el texto",
} as const;
```

Keep strings in their existing topic file and as plain string literals. Add the pack's catalog
import and one `localePackages` entry to [`locales/index.ts`](index.ts), then run
`npm run check:i18n`. The check enforces exact directory-to-registry parity and validates every
registered locale. See the root
[`CONTRIBUTING.md`](../CONTRIBUTING.md) for the short contribution workflow.

# Formatting

Quiltor uses deterministic formatters. Each file type has exactly one
authoritative formatter.

| Files                               | Formatter    |
| ----------------------------------- | ------------ |
| TypeScript, TSX, JavaScript         | Biome        |
| JSON, JSONC, CSS                    | Biome        |
| Python                              | Ruff         |
| Rust                                | rustfmt      |
| Markdown, YAML, HTML                | Prettier     |
| General whitespace and line endings | EditorConfig |

## Format everything

```bash
npm run format
```

This aggregate currently covers web, Python and documentation files. Format Rust with
`cargo fmt --all`; CI checks it separately with `cargo --locked fmt --check`.

Check formatting without writing with `npm run check:format` and the Rust check above.

The [cross-project engineering standard](standards/README.md) provides reusable formatting,
startup and versioning rules with configuration templates. [Quiltor's profile](standards/quiltor.md)
records the current implementation and the remaining adoption work.

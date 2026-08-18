# Formatting

Quiltor uses deterministic formatters. Each file type has exactly one
authoritative formatter.

| Files                               | Formatter    |
| ----------------------------------- | ------------ |
| TypeScript, TSX, JavaScript         | Biome        |
| JSON, JSONC, CSS                    | Biome        |
| Python                              | Ruff         |
| Markdown, YAML, HTML                | Prettier     |
| General whitespace and line endings | EditorConfig |

## Format everything

```bash
npm run format
```

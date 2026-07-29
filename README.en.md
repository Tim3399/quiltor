# Quiltor

[Deutsch](README.md) · [English](README.en.md)

Quiltor is a local-first writing workspace for manuscripts, characters, places,
concepts, and their relationships. It runs in the browser while keeping every
world in a separate SQLite database on your own computer.

## Features

- Chapter-based manuscript editor with focus mode and discreet writing aids
- Visual character and world board with draggable nodes and relationships
- Undo and redo for manuscripts and diagrams
- Chapter versions, Git history, and readable diffs
- Light and dark themes
- German and English interface
- Book-style PDF export in a readable 6 × 9 inch format
- Local SQLite storage with revision checks and backups
- Multiple independent worlds from a neutral start screen

Quiltor starts without bundled example content. Your manuscripts, character
profiles, databases, mirrors, and backups are ignored by Git.

## Quick start

The production build only requires Python 3:

```bash
python3 server.py
```

Quiltor opens at `http://localhost:8000`. To choose another port or prevent the
browser from opening automatically:

```bash
python3 server.py 8080 --no-open
```

Create your first world on the start screen and provide its own GitHub
repository URL. Its manuscript, character board, and backups remain separate
from every other world and from the Quiltor source repository.

## Development

```bash
npm install
npm run dev
npm test
npm run build
python3 -m unittest discover -s tests/backend -v
npm run test:e2e
```

Run `python3 server.py --no-open` alongside `npm run dev`; Vite forwards API
requests to the Python server on port 8000. End-to-end tests also require a
running server.

## Data and privacy

SQLite is the authoritative data source. Each world is stored under
`data/worlds/`. Quiltor also creates readable Markdown mirrors and local
database backups:

- `data/manuscripts/*.md` — readable manuscript mirror
- `data/profiles/*.md` — readable character profiles
- `data/backups/` — automatic SQLite backups

All of these world-specific files are excluded from the public repository.
Writes use revision checks, so an older browser tab cannot silently overwrite a
newer version. Restoring a backup first preserves the current state as another
backup.

Git backups are handled by a dedicated backend service. Each world has an
isolated working repository under `data/repositories/` containing a consistent
SQLite snapshot plus readable manuscript and profile mirrors. Quiltor never
stores GitHub credentials; it uses the Git authentication configured locally.

## Project structure

```text
.
├── backend/                  SQLite storage, Git backup, and validation
├── src/
│   ├── app/                  application shell and navigation
│   ├── config/               product configuration
│   ├── design/colors.css     all light and dark color tokens
│   ├── features/
│   │   ├── manuscript/       editor, chapter binder, writing aids
│   │   ├── figures/          world graph and profile inspector
│   │   ├── tools/            search, history, Git, and backups
│   │   └── worlds/           world selection and creation
│   ├── hooks/                autosave, theme, and undo/redo state
│   ├── i18n/                 German and English interface strings
│   ├── lib/                  API client and file exports
│   └── shared/ui/            reusable accessible UI components
├── scripts/                  book PDF renderer
├── tests/                    backend and browser tests
├── server.py                 local HTTP server and API
└── package.json              frontend build and test commands
```

Feature modules may depend on shared UI, hooks, libraries, and domain types,
but should not import other feature modules directly. The backend does not
depend on frontend code.

## License

No license has been selected yet. Until one is added, the source remains
copyrighted and is available for inspection only.

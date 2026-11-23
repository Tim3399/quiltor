# Real files (T-364, D-249)

Files as they reach Quiltor from outside: saved by Word, by an image writer with EXIF, by an
older Quiltor. A hand-built fixture cannot carry what those writers add, and that is what
this folder is for. `tests/python/test_real_files.py` reads every file once through the route
a user's file takes. It fails when a file here has no route, when a route has no file, and
when a file is missing from the table below. A new file therefore needs its origin written
down in the same change.

The folder grows, it does not change: a file stays as it is, and a new case is a new file.

No real manuscript, no photograph of anybody, no data of a real user. Texts come from the
test world (`tests/world/texts/base.de.mjs`), pictures are drawn by a script.

| File                                       | Route                         | Origin                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../manuscript-import/word-multipage.docx` | manuscript import             | F0 (T-334), saved by Microsoft Word 16.0 (build 16.0.20625) over COM. Referenced, not copied: the manuscript-import tests read it where it lies. Eight chapters of the base test world. Details in `../manuscript-import/WORD-FIXTURES.md`.                                                                                                          |
| `../manuscript-import/word-symbol.docx`    | manuscript import             | F1 (T-334), F0 plus two `w:sym` symbols. Same Word, same text, same note as above. Referenced, not copied.                                                                                                                                                                                                                                           |
| `../manuscript-import/word-markers.docx`   | manuscript import             | F2 (v3.26.2, F-334-1 and F-337-1), saved by the same Word: chapter 1 with a bookmark, an English paragraph and a `noProof` run. Referenced, not copied.                                                                                                                                                                                              |
| `photo-exif6.jpg`                          | map image (`place_map` store) | JPEG, 400 x 300, drawn with Pillow 11.3 (sea, coast, compass cross; no photograph), saved with EXIF orientation 6, as a phone held upright writes it (T-358). Stored size 400 x 300, shown 300 x 400.                                                                                                                                                |
| `photo-exif8.jpg`                          | map image (`place_map` store) | The same drawing, EXIF orientation 8 (phone turned the other way).                                                                                                                                                                                                                                                                                   |
| `map-exif6.png`                            | map image (`place_map` store) | The same drawing as PNG with an `eXIf` chunk, orientation 6, written by Pillow (T-360).                                                                                                                                                                                                                                                              |
| `map-exif6.webp`                           | map image (`place_map` store) | The same drawing as lossy WebP with an `EXIF` chunk, orientation 6, written by Pillow with libwebp (T-360).                                                                                                                                                                                                                                          |
| `scene-separators.md`                      | manuscript import             | Chapter 1 of the base test world (`ch.c1`, title and the first six paragraphs), the paragraphs divided by `* * *`, `***`, `---`, `___` and `- - -`, one each (T-335). Written by a script, UTF-8, LF.                                                                                                                                                |
| `world-schema-v3.sqlite3`                  | open and migrate, then save   | A schema 3 world (T-322): the figure tables as version 3 wrote them (`LEGACY_V3_FIGURE_SCHEMA` of `tests/python/test_storage.py`), three figures of the test world (Mara Venn, Iven Rook, Nordhafen) with their subtitles, age and role. No chapters; version 3 had none.                                                                            |
| `world-schema-v14.sqlite3`                 | open and migrate, then save   | A schema 14 world (T-322): the German base world as shipped (`src/quiltor/resources/example_world/de.json`) saved through the document use cases into a fresh database, then turned back into what 3.25 wrote, the way `tests/python/test_reference_note_migration.py` does: `schema_version` = 14 and the card `reference-archive` carrying a text. |

## How the pictures and worlds were made

One script, not kept in the repository, run once with Python 3.12 and Pillow 11.3.0 from the
repository root:

- `Image.new("RGB", (400, 300))`, a coast polygon, a grid and a compass cross drawn with
  `ImageDraw`. The EXIF block holds the single tag `0x0112` (orientation) and is passed as
  `exif=` to `save`; JPEG quality 85, WebP quality 80.
- The markdown is `ch.c1.title` as a heading and `ch.c1.body` split at the blank lines.
- Both worlds are SQLite files with `journal_mode=DELETE` and a `VACUUM` at the end, so no
  `-wal` file belongs to them.

Word and LibreOffice: no LibreOffice is installed on the machine that made this folder, so
there is no LibreOffice-saved DOCX yet. Add one here, with its row, when one is made.

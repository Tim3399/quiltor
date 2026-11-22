# Word-saved DOCX fixtures (T-334)

`harbor.docx` is assembled by hand. These two are saved by Microsoft Word itself, so they
carry what Word writes and a hand-built file does not: `docProps/app.xml` naming
"Microsoft Office Word", Word's full `styles.xml`, and `w:lastRenderedPageBreak` in every
run where its layout began a page.

- **Word:** 16.0, build 16.0.20625 (Microsoft 365, Windows), 2026-11-22.
- **Made by:** Word automation over COM from PowerShell: a new blank document; each chapter
  title in "Überschrift 1" (`wdStyleHeading1`), its paragraphs in "Standard", a manual page
  break before every chapter after the first; `Repaginate()` and then `SaveAs2(…, 16)`
  (`wdFormatDocumentDefault`). Without the repagination a hidden Word saves one page and no
  `lastRenderedPageBreak`.
- **Text:** the eight chapters of the base test world, `tests/world/texts/base.de.mjs`
  (`ch.c1` to `ch.c8`, title and body). No real manuscript.

| File                  | Pages | What it is for                                                                                                                                                                                                         |
| --------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `word-multipage.docx` | 8     | F0: plain multi-page Word file, no footnotes. 7 × `w:lastRenderedPageBreak`.                                                                                                                                           |
| `word-symbol.docx`    | 8     | F1: F0 plus one paragraph at the end of chapter 1, "Kompassrose ⟨sym⟩ und Windrichtung ⟨sym⟩", inserted with `InsertSymbol`: `<w:sym w:font="Wingdings" w:char="F0AB"/>` and `<w:sym w:font="Symbol" w:char="F05E"/>`. |

Word did not write `word/footnotes.xml` for either file: it creates that part only once a
note has been inserted, and then keeps its separator entries even after the note is deleted.

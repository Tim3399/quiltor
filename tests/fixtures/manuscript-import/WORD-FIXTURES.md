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

| File                  | Pages | What it is for                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `word-multipage.docx` | 8     | F0: plain multi-page Word file, no footnotes. 7 × `w:lastRenderedPageBreak`.                                                                                                                                                                                                                                                                                 |
| `word-symbol.docx`    | 8     | F1: F0 plus one paragraph at the end of chapter 1, "Kompassrose ⟨sym⟩ und Windrichtung ⟨sym⟩", inserted with `InsertSymbol`: `<w:sym w:font="Wingdings" w:char="F0AB"/>` and `<w:sym w:font="Symbol" w:char="F05E"/>`.                                                                                                                                       |
| `word-markers.docx`   | 1     | F2 (v3.26.2, F-334-1 and F-337-1): chapter 1 only. A bookmark over body paragraphs 2 and 3 (`Bookmarks.Add`), so Word writes `w:bookmarkEnd` directly in `w:body`; body paragraph 5 set to English (`LanguageID = 1033`, `w:lang` on its runs); "Iven Rook" in it set to `NoProofing` (`w:noProof`). Nothing of it is lost, so the import brings no warning. |

Word did not write `word/footnotes.xml` for either file: it creates that part only once a
note has been inserted, and then keeps its separator entries even after the note is deleted.

F2 was made the same way on 2026-11-22 (Word 16.0, build 16.0.20625), from chapter 1 of
`tests/world/texts/base.de.mjs`, then the bookmark, language and proofing settings above
were applied over COM before `Repaginate()` and `SaveAs2(…, 16)`.

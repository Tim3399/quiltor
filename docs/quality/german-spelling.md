# German spelling guard

`npm run check:i18n` (part of `npm run check` and of `npm run build`) fails when German
interface text uses a spelling the product does not use. It exists because a wrong
spelling is a defect nobody sees in code review: "Massstab" sat in a map menu and was
found by the author, not by a tool.

## What it reads

- Every string literal in `locales/de/*.ts`, not only `key: "value"` pairs.
- Every string literal and JSX text node in the client sources under `packages/client/src`
  (`.ts` and `.tsx`), except tests, stories and `design/testing`. This is the "hard-wired
  German" case; today the catalog check keeps it small, but it is not zero.
- Not read: comments, identifiers, `locales/en`. Developer-facing text is English and may
  quote a German string.

## The list

`FORBIDDEN_SPELLINGS` in `tools/quality/term_spelling.mjs`. One row is a pattern, the
replacement shown to the developer, and a comment saying why the wrong form exists. The
starting list came from one pass over the 1296 catalog messages and covers four groups:

| Group                    | Examples                                                               |
| ------------------------ | ---------------------------------------------------------------------- |
| ss instead of ß          | Massstab, Grösse, Fussnote, schliessen, ausserdem, Fliesstext, gross   |
| ae/oe/ue for umlauts     | fuer, ueber, zurueck, oeffnen, Aenderung (whole words, never `neue`)   |
| Hyphen/compound variants | Story Board, Ereader, Email, Cloud Backup, quiltor-Projekt, Back-up    |
| Terms of the world       | Zeitleiste/Zeitstrahl (it is Timeline), Schauplatz/Location, Inspektor |

To add a rule, add a row and an example pair (wrong, right) to
`tools/quality/term_spelling.test.mjs`; the test fails when a row has no example. Keep the
pattern narrow. There is no per-line exception: if a legitimate German text trips a rule,
narrow the pattern (`Gross` and `Weiss` are matched lower-case only because they are
surnames) or remove the row.

## Findings on the day it was introduced

One: `chapterStoryTimeEmpty` said "in der Zeitleiste", every other place says "Timeline".
Changed to "Timeline". No exceptions are configured.

## Relation to the earlier guard

`packages/client/src/i18n/placesScaleSpelling.test.ts` (T-78) checked only "Maßstab", in
the runtime catalog, under vitest. Its rule is the first row of the list, and the list
also reaches hard-wired strings, so the test was removed rather than kept as a second copy
of the same regex.

## Proving it

Replace "Maßstab" by "Massstab" anywhere in `locales/de/places.ts` and run
`npm run check:i18n`: it prints `spelling "Massstab" -> use "Maßstab"` and exits 1.

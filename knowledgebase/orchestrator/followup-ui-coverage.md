# Follow-up rendered UI coverage

This ledger records the CLOSE-02 local audit. It is test evidence, not release or remote-CI
evidence. The screenshots, traces, and downloads live outside the repository under
`%TEMP%/quiltor-followup-audit`.

## Runtime identity

- Final local frontend asset: `dist/assets/index-aUSy44Mh.js`
- SHA-256: `F0B6EBEA6ADC6290F0E668E5AC7F6FED9F12F7E1C29F4C1C4E85D19E99CA0464`
- Isolated API/frontend ports: `8132` / `5292`
- Isolated data and home: `%TEMP%/quiltor-followup-audit/data` and
  `%TEMP%/quiltor-followup-audit/home`

## Coverage ledger

The automated matrix uses the Playwright `wide` and `compact` projects in both light and dark
themes. Each row ran in all four combinations unless stated otherwise.

| Area                        | Action                                                                                                                        | Expected result                                                                               | Actual local result                                                                                                                                                                                   | Evidence                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| DOCX import preview         | Load `harbor.docx` through the public import dialog                                                                           | Preview, chapter controls, project title, and confirmation remain visible and contained       | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-import-200-percent.png`  |
| Enlarged text reflow        | Reduce the CSS viewport to 720px or 320px and set every visible import-dialog element to twice its computed font size         | Computed font size doubles; dialog and controls reflow without horizontal clipping            | Passed in all four combinations                                                                                                                                                                       | Same import screenshots; actual browser zoom is tracked separately below |
| Import network error        | Abort the preview request once                                                                                                | An announced error remains in the open, contained dialog                                      | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-network-error.png`       |
| Destructive confirmation    | Open world deletion, inspect, then cancel                                                                                     | Alert dialog is contained and cancel leaves the world intact                                  | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-destructive.png`         |
| DOCX export preview         | Open **DOCX fürs Lektorat**                                                                                                   | Chapter preview is contained and the dialog has no Axe violations                             | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-docx-export.png`         |
| EPUB export preview         | Open **EPUB für E-Reader**                                                                                                    | Chapter, default title/author/language, warnings, and download action remain visible          | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-epub-export.png`         |
| History                     | Open the saved snapshot comparison after changing manuscript text                                                             | Inserted/deleted text remains readable and contained                                          | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-history.png`             |
| Structured validation error | Import malformed figure JSON                                                                                                  | Announced validation error appears and all three seeded nodes remain                          | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*dialogs*/{light,dark}-*-validation-error.png`    |
| Conflict recovery           | Create a real two-page 409, close once to retain the draft, reopen, compare, download both versions, and keep the local draft | Both versions remain available; chosen local text persists                                    | Passed in all four combinations, including compact 320/390/719px containment, local workspace scrolling, 44px actions, relocated Search/Assistant access, and restored direct access after resolution | `final-matrix-restored/*dialogs*/{light,dark}-*-recovery.png` and traces |
| Populated storyboard        | Edit one of two connected note cards in a seeded group and wait for the PUT                                                   | Edited text persists in the rendered card and workspace stays contained                       | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*populated*/{light,dark}-*-storyboard.png`        |
| Distance                    | Enter measure mode and select Nordhafen then Südhafen                                                                         | A targeted, accessible edge exposes a numeric value and unit                                  | Passed: `400 Einheiten (kein Maßstab gesetzt)` in all four combinations                                                                                                                               | `final-matrix-restored/*populated*/{light,dark}-*-distance.png`          |
| Map creation                | Choose a real PNG through the file picker                                                                                     | A persisted map-image ID and visible **Neue Karte** image appear; workspace remains contained | Passed in all four combinations                                                                                                                                                                       | `final-matrix-restored/*populated*/` traces and rerun screenshots        |

## Resolved finding

At 390px, a manuscript save conflict previously made the app bar and document 405px wide and let
the page shift 15px horizontally. Compact error mode now keeps SaveStatus, retry, recovery, More,
and one locally scrollable workspace target direct; Search and Assistant remain available through
More. The restored matrix proves document containment at 320, 390, and 719px, reaches every
workspace target in its local scroller, and checks focus and 44px critical actions. A built
mutation forcing recovery to 20px failed the regression at exactly that assertion before source
and dist were restored.

## Zoom evidence

The main matrix deliberately distinguishes enlarged text from browser zoom. Its CSS viewport and
computed-font check is a deterministic text-reflow stress case. The independent browser run used
an isolated extension to set and read back `tabs.setZoom(2)` / `tabs.getZoom()`. It passed all 20
light/dark surfaces at 900px and 390px CSS widths on the same final bundle. See
[followup-zoom-evidence.md](./followup-zoom-evidence.md) for measurements and screenshots.

## Executed checks

The final restored source and dist were checked with these commands from the repository root:

```powershell
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build
node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" test
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:8132'; node node_modules/@playwright/test/cli.js test tests/e2e/audit-followup.spec.ts --project wide --project compact --output "$env:TEMP/quiltor-followup-audit/final-matrix-restored" --reporter=line
```

- Build: passed, producing `index-aUSy44Mh.js` with the SHA-256 recorded above.
- Client suite: 228 test files and 1,539 tests passed in 72.38 seconds.
- Rendered matrix: 8 of 8 cases passed in 34.7 seconds.

The touch-target mutation proof used this sequence:

1. Temporarily replace `.app-bar--save-error .app-save-recovery` with `width: 20px` and
   `min-width: 20px`.
2. Run the same build command above.
3. Restart the isolated launcher with:

   ```powershell
   $env:QUILTOR_API_PORT='8132'; $env:QUILTOR_DEV_PORT='5292'; $env:QUILTOR_HOME="$env:TEMP\quiltor-followup-audit\home"; $env:QUILTOR_DATA_DIR="$env:TEMP\quiltor-followup-audit\data"; node tools/dev/start-workshop.mjs
   ```

4. Run:

   ```powershell
   $env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:8132'; node node_modules/@playwright/test/cli.js test tests/e2e/audit-followup.spec.ts --project compact --grep 'light: dialogs' --output "$env:TEMP/quiltor-followup-audit/recovery-target-built-mutation" --reporter=line
   ```

   The test failed as intended: **Entwurf retten width at 320px**, expected at least 44px,
   received 20px.

5. Restore `min-width: var(--control-touch)`, rerun the build, restart the launcher, and run the
   complete matrix command above. The restored matrix passed 8 of 8.

After browser and zoom checks, the launcher was stopped, ports 8132 and 5292 were verified as no
longer listening, and only `%TEMP%/quiltor-followup-audit/home` and `data` were removed. Screenshot,
trace, and mutation evidence remain under `%TEMP%/quiltor-followup-audit`.

## Remaining acceptance

- Keep platform visual-baseline review separate. Local checks do not establish release or remote-CI
  status.

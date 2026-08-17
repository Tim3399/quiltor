# Phase 0: Adaptive UI baseline

Recorded on 2026-08-09. This document describes the reproducible baseline before any further phase is implemented.

## Fixed viewports

| Name | Size | Intended layout |
| --- | ---: | --- |
| `wide` | 1440 × 900 | navigation, content, and inspector |
| `regular` | 900 × 760 | one overlaying sidebar at most |
| `compact` | 390 × 844 | sheet-oriented, touch-sized controls |

The values are exported from `playwright.config.ts`. Visual baselines cover World Gate, manuscript, figures, timeline, places, a dialog, and the assistant in light and dark for every viewport.

Regenerate intentionally with:

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8151 npx playwright test tests/e2e/visual-baseline.spec.ts --update-snapshots
```

## Quality gates

- Frontend unit/component tests: `npm test`
- Backend tests: `env -u QUILTOR_OIDC_ISSUER python3 -m unittest discover -s tests/backend -p 'test_*.py'` — unsetting the issuer runs the suite against the local identity (one user, no login page), not without authentication: every request has a session either way, and the OIDC identity is simply the other one of the two.
- Build, design, and i18n: `npm run build`
- Adaptive E2E and screenshots: `npm run test:e2e`
- Whitespace/errors: `git diff --check`

The E2E suite includes Axe WCAG A/AA checks for manuscript, figures, and timeline in light and dark. Keyboard baselines cover global shortcuts, command palette, focus mode, dialogs, both tiers of destructive confirmation, and language choice. Manual screen-reader verification remains required before release because automated role checks cannot validate announcement quality.

## Performance baseline

`visual-baseline.spec.ts` records and attaches:

- navigation-to-editor readiness with a 270,000-character chapter;
- manuscript-to-figures workspace-switch readiness;
- the exact chapter character count.

The deliberately broad regression ceilings are 5 seconds for initial readiness and 2 seconds for workspace switching on the Wide Chromium project. Attached measurements provide the comparison values for later phases; the thresholds are guards, not performance targets.

## Final status after the adaptive writing rollout

- The runtime MutationObserver translation fallback has been removed; productive UI text is localized explicitly and key parity is a build gate.
- Reusable visual foundations live in `src/design/`; `src/styles.css` retains feature layout wiring that will remain feature-local until a later modularization pass.
- Visual snapshots are Chromium baselines. WebKit compatibility remains covered separately when release testing is performed.

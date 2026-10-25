// stylelint checks what Biome's CSS linter does not. Biome (`npm run lint:biome`) is the
// primary CSS linter here, so every stylelint rule whose job an active Biome rule already
// does is switched off below, each with the Biome rule that covers it. Formatting is left to
// Biome and Prettier: no stylistic rule is enabled, so none can disagree with them.
// The mapping is also tabulated in docs/quality/linting.md.
import recommended from "stylelint-config-recommended";

/** @type {import("stylelint").Config} */
export default {
  extends: [recommended],
  // dist/ is committed build output, node_modules/ and the others are vendored or generated.
  ignoreFiles: [
    "**/node_modules/**",
    "dist/**",
    "build/**",
    "coverage/**",
    "**/.venv*/**",
    "**/venv/**",
    "**/target/**",
    "runtime/**",
    "models/**",
    "test-results/**",
    "playwright-report/**",
  ],
  rules: {
    // --- Duplicates of active Biome rules (off here, on in Biome) ---
    "at-rule-no-unknown": null, // Biome: suspicious/noUnknownAtRules
    "block-no-empty": null, // Biome: suspicious/noEmptyBlock
    "custom-property-no-missing-var-function": null, // Biome: correctness/noMissingVarFunction
    "declaration-block-no-duplicate-custom-properties": null, // Biome: suspicious/noDuplicateCustomProperties
    "declaration-block-no-duplicate-properties": null, // Biome: suspicious/noDuplicateProperties
    "declaration-block-no-shorthand-property-overrides": null, // Biome: suspicious/noShorthandPropertyOverrides
    "font-family-no-duplicate-names": null, // Biome: suspicious/noDuplicateFontNames
    "font-family-no-missing-generic-family-keyword": null, // Biome: a11y/useGenericFontNames
    "keyframe-block-no-duplicate-selectors": null, // Biome: suspicious/noDuplicateSelectorsKeyframeBlock
    "keyframe-declaration-no-important": null, // Biome: suspicious/noImportantInKeyframe
    "media-feature-name-no-unknown": null, // Biome: correctness/noUnknownMediaFeatureName
    "media-type-no-deprecated": null, // Biome: complexity/noDeprecatedMediaType
    "named-grid-areas-no-invalid": null, // Biome: correctness/noInvalidGridAreas
    "no-duplicate-at-import-rules": null, // Biome: suspicious/noDuplicateAtImportRules
    "no-invalid-position-at-import-rule": null, // Biome: correctness/noInvalidPositionAtImportRule
    "no-irregular-whitespace": null, // Biome: suspicious/noIrregularWhitespace
    "property-no-unknown": null, // Biome: correctness/noUnknownProperty
    "selector-anb-no-unmatchable": null, // Biome: correctness/noUnmatchableAnbSelector
    "selector-pseudo-class-no-unknown": null, // Biome: correctness/noUnknownPseudoClass
    "selector-pseudo-element-no-unknown": null, // Biome: correctness/noUnknownPseudoElement
    "selector-type-no-unknown": null, // Biome: correctness/noUnknownTypeSelector

    // --- Off for the same reason as Biome's style/noDescendingSpecificity (see biome.json) ---
    // It compares any two selectors whose last compound matches, whether or not they can ever
    // select the same element; reordering stylesheets to satisfy it moves the cascade without
    // fixing anything. The visual baselines and the design suite guard the cascade.
    "no-descending-specificity": null,

    // --- Beyond the recommended preset, and not covered by Biome ---
    "color-no-invalid-hex": true,
  },
};

// ESLint runs only the React Compiler rules from eslint-plugin-react-hooks.
// Biome stays the general linter; no other ESLint rules or plugins belong here.
//
// Parser: @babel/eslint-parser, because typescript-eslint cannot run with
// TypeScript 7.0.2 (the package no longer ships a JS compiler API). The
// react-hooks rules are syntactic, so Babel's TypeScript syntax support is
// enough. Switch to typescript-eslint once it supports TypeScript 7.
//
// Babel is configured inline only (configFile/babelrc false) so that Vite and
// Vitest never pick up a Babel config by accident. With both set to false the
// parser skips Babel's config loading and ignores presets; it reads only
// parserOpts.plugins, so the syntax plugins are named here per extension.
import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";

function babelFor(plugins) {
  return {
    parser: babelParser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: {
        configFile: false,
        babelrc: false,
        parserOpts: { plugins },
      },
    },
  };
}

const shared = {
  linterOptions: { reportUnusedDisableDirectives: "error" },
  plugins: { "react-hooks": reactHooks },
  rules: {
    ...reactHooks.configs["recommended-latest"].rules,
    // Off: Biome already enforces these (lint/correctness/useHookAtTopLevel and
    // lint/correctness/useExhaustiveDependencies), and the existing Biome
    // suppression reasons would otherwise need a second copy.
    "react-hooks/rules-of-hooks": "off",
    "react-hooks/exhaustive-deps": "off",
  },
};

export default [
  {
    ...shared,
    files: ["packages/client/src/**/*.ts"],
    languageOptions: babelFor(["typescript"]),
  },
  {
    ...shared,
    files: ["packages/client/src/**/*.tsx"],
    languageOptions: babelFor(["typescript", "jsx"]),
  },
];

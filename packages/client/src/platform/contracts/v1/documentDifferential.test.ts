import { describe, expect, it } from "vitest";
import manifest from "../../../../../../contracts/manifest.json";
import manuscriptCorpusValue from "../../../../../../contracts/fixtures/application-api/manuscript/differential.v1.json";
import manuscriptFixture from "../../../../../../contracts/fixtures/application-api/manuscript/wire.v1.json";
import storyWorldCorpusValue from "../../../../../../contracts/fixtures/application-api/story-world/differential.v1.json";
import storyWorldFixture from "../../../../../../contracts/fixtures/application-api/story-world/wire.v1.json";
import { decodeManuscriptV1, encodeManuscriptV1 } from "./manuscript";
import { decodeStoryWorldV1, encodeStoryWorldV1 } from "./storyWorld";
import { ENTITY_ALIAS_NORMALIZATION_V1, normalizeEntityAliasV1 } from "../../../shared";

type Expectation = "accept" | "reject";
type DifferentialValue = unknown;

interface OptionalPresenceCase {
  id: string;
  path: string;
  alsoRemove?: string[];
  absent: Expectation;
  null: Expectation;
}

interface DifferentialCase {
  id: string;
  operation: "set" | "remove";
  path: string;
  value?: DifferentialValue;
  expect: Expectation;
  canonical?: "integer";
}

interface DifferentialCorpus {
  contract: string;
  version: 1;
  baseFixture: string;
  normalizationAlgorithm?: string;
  normalization?: Array<{ id: string; input: string; expected: string }>;
  optionalPresence: OptionalPresenceCase[];
  cases: DifferentialCase[];
}

function materialize(value: DifferentialValue): DifferentialValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const special = value as { $special?: string; count?: number };
    if (special.$special === "nan") return Number.NaN;
    if (special.$special === "infinity") return Number.POSITIVE_INFINITY;
    if (special.$special === "astral") return "😀".repeat(special.count ?? 0);
  }
  return structuredClone(value);
}

function segments(path: string): string[] {
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function mutate(
  base: unknown,
  path: string,
  operation: "set" | "remove",
  value?: DifferentialValue,
): unknown {
  const candidate = structuredClone(base) as Record<string, unknown>;
  const parts = segments(path);
  const key = parts.pop();
  if (key === undefined) throw new Error(`Invalid differential path: ${path}`);
  let parent: Record<string, unknown> | unknown[] = candidate;
  for (const part of parts) {
    parent = (parent as Record<string, unknown>)[part] as Record<string, unknown> | unknown[];
    if (parent === null || typeof parent !== "object") {
      throw new Error(`Missing differential path: ${path}`);
    }
  }
  if (operation === "remove") delete (parent as Record<string, unknown>)[key];
  else (parent as Record<string, unknown>)[key] = materialize(value);
  return candidate;
}

function atPointer(value: unknown, path: string): unknown {
  return segments(path).reduce((current, key) => (current as Record<string, unknown>)[key], value);
}

function manuscriptRoundTrip(value: unknown): unknown {
  const decoded = decodeManuscriptV1(value);
  const encoded = encodeManuscriptV1(decoded.document, decoded.revision);
  decodeManuscriptV1(encoded);
  return encoded;
}

function storyWorldRoundTrip(value: unknown): unknown {
  const decoded = decodeStoryWorldV1(value);
  const encoded = encodeStoryWorldV1(decoded.document, decoded.revision);
  decodeStoryWorldV1(encoded);
  return encoded;
}

const runtimes = [
  {
    corpus: manuscriptCorpusValue as DifferentialCorpus,
    base: manuscriptFixture,
    roundTrip: manuscriptRoundTrip,
  },
  {
    corpus: storyWorldCorpusValue as DifferentialCorpus,
    base: storyWorldFixture,
    roundTrip: storyWorldRoundTrip,
  },
];

describe("registered document v1 differential corpora", () => {
  it("registers one checked corpus on each document contract", () => {
    for (const runtime of runtimes) {
      const contract = manifest.contracts.find(
        (item) => item.name === runtime.corpus.contract && item.version === 1,
      );
      expect(
        contract?.fixtures.some(
          (fixture) =>
            fixture.path.endsWith("/differential.v1.json") && fixture.role === "differential",
        ),
        runtime.corpus.contract,
      ).toBe(true);
    }
  });

  it("runs the frozen alias-normalization vectors without runtime Unicode tables", () => {
    const corpus = storyWorldCorpusValue as DifferentialCorpus;
    expect(corpus.normalizationAlgorithm).toBe(ENTITY_ALIAS_NORMALIZATION_V1);
    for (const vector of corpus.normalization ?? []) {
      expect(normalizeEntityAliasV1(vector.input), vector.id).toBe(vector.expected);
    }
  });

  for (const runtime of runtimes) {
    it(`${runtime.corpus.contract} keeps absent distinct from explicit null`, () => {
      for (const presence of runtime.corpus.optionalPresence) {
        let prepared: unknown = runtime.base;
        for (const path of presence.alsoRemove ?? []) {
          prepared = mutate(prepared, path, "remove");
        }
        const absent = mutate(prepared, presence.path, "remove");
        const explicitNull = mutate(prepared, presence.path, "set", null);
        expect(() => runtime.roundTrip(absent), `${presence.id}: absent`).not.toThrow();
        expect(() => runtime.roundTrip(explicitNull), `${presence.id}: null`).toThrow();
      }
    });

    it(`${runtime.corpus.contract} matches every registered edge-case expectation`, () => {
      for (const differential of runtime.corpus.cases) {
        const candidate = mutate(
          runtime.base,
          differential.path,
          differential.operation,
          differential.value,
        );
        if (differential.expect === "reject") {
          expect(() => runtime.roundTrip(candidate), differential.id).toThrow();
          continue;
        }
        let canonical: unknown;
        expect(() => {
          canonical = runtime.roundTrip(candidate);
        }, differential.id).not.toThrow();
        if (differential.canonical === "integer") {
          expect(
            Number.isSafeInteger(atPointer(canonical, differential.path)),
            differential.id,
          ).toBe(true);
        }
      }
    });
  }
});

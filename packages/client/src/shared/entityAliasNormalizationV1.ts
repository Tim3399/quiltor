import aliasNormalizationRules from "../../../../contracts/application-api/story-world/alias-normalization.v1.json" with {
  type: "json",
};

export const ENTITY_ALIAS_NORMALIZATION_V1 = aliasNormalizationRules.algorithm;

function isSeparator(codePoint: number): boolean {
  return aliasNormalizationRules.separatorRanges.some(
    ({ minimum, maximum }) => codePoint >= minimum && codePoint <= maximum,
  );
}

/** Frozen v1 identity: ASCII case/separators only; every non-ASCII code point is opaque. */
export function normalizeEntityAliasV1(value: string): string {
  const tokens: string[] = [];
  let token = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (isSeparator(codePoint)) {
      if (!token) continue;
      tokens.push(token);
      token = "";
      continue;
    }
    const { minimum, maximum, lowercaseOffset } = aliasNormalizationRules.asciiUppercase;
    token +=
      codePoint >= minimum && codePoint <= maximum
        ? String.fromCodePoint(codePoint + lowercaseOffset)
        : character;
  }
  if (token) tokens.push(token);
  return tokens.join(" ");
}

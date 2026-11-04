import type { MessageKey } from "../../i18n/catalogs";

/**
 * The dictionary data keeps Wiktextract's language-neutral `pos` key (`noun`, `verb`, ...); the
 * author reads it in the interface language. A key this table does not know is shown as it
 * stands, so a new value from another source stays visible instead of vanishing.
 */
const PART_OF_SPEECH_LABELS: Readonly<Record<string, MessageKey>> = {
  noun: "partOfSpeechNoun",
  name: "partOfSpeechName",
  verb: "partOfSpeechVerb",
  adj: "partOfSpeechAdj",
  adv: "partOfSpeechAdv",
  pron: "partOfSpeechPron",
  prep: "partOfSpeechPrep",
  postp: "partOfSpeechPostp",
  conj: "partOfSpeechConj",
  intj: "partOfSpeechIntj",
  num: "partOfSpeechNum",
  article: "partOfSpeechArticle",
  det: "partOfSpeechDet",
  particle: "partOfSpeechParticle",
  abbrev: "partOfSpeechAbbrev",
  phrase: "partOfSpeechPhrase",
  proverb: "partOfSpeechProverb",
  contraction: "partOfSpeechContraction",
  prefix: "partOfSpeechPrefix",
  suffix: "partOfSpeechSuffix",
  affix: "partOfSpeechAffix",
  symbol: "partOfSpeechSymbol",
  character: "partOfSpeechCharacter",
};

export function partOfSpeechLabel(value: string, t: (key: MessageKey) => string): string {
  const key = Object.hasOwn(PART_OF_SPEECH_LABELS, value)
    ? PART_OF_SPEECH_LABELS[value]
    : undefined;
  return key ? t(key) : value;
}

import type { MessageKey } from "../../../i18n";
import type { WritingLocale } from "../model";

export type WritingLocaleDefinition = {
  code: WritingLocale;
  labelKey: MessageKey;
  grammarAvailable: boolean;
  dictionaryAvailable: boolean;
  thesaurusAvailable: boolean;
  translationTargets: string[];
};

export const writingLocales: Record<WritingLocale, WritingLocaleDefinition> = {
  "de-DE": {
    code: "de-DE",
    labelKey: "writingLanguageGerman",
    grammarAvailable: true,
    dictionaryAvailable: true,
    thesaurusAvailable: true,
    translationTargets: ["en"],
  },
};

export const defaultWritingLocale: WritingLocale = "de-DE";

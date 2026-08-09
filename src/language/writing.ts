import type { MessageKey } from './index';

export type WritingLanguage = 'de-DE';

export type WritingLanguageDefinition = {
  code: WritingLanguage;
  labelKey: MessageKey;
  grammarAvailable: boolean;
  dictionaryAvailable: boolean;
  thesaurusAvailable: boolean;
  translationTargets: string[];
};

export const writingLanguages: Record<WritingLanguage, WritingLanguageDefinition> = {
  'de-DE': {
    code: 'de-DE',
    labelKey: 'writingLanguageGerman',
    grammarAvailable: true,
    dictionaryAvailable: true,
    thesaurusAvailable: true,
    translationTargets: ['en'],
  },
};

export const defaultWritingLanguage: WritingLanguage = 'de-DE';

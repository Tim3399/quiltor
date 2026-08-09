import { describe, expect, it } from 'vitest';
import { defaultWritingLanguage, writingLanguages } from './writing';

describe('writing language registry', () => {
  it('keeps manuscript language independent from interface languages', () => {
    expect(defaultWritingLanguage).toBe('de-DE');
    expect(writingLanguages['de-DE']).toMatchObject({ dictionaryAvailable: true, thesaurusAvailable: true, translationTargets: ['en'] });
  });
});

/** AI output validation: nothing malformed gets through. */
import { describe, expect, it } from 'vitest';
import {
  parseModelJson,
  validateDraftText,
  validateKeywordResult,
  validateRelevanceResult,
  validateScoreResult,
} from '@/lib/validation';
import { SAMPLE_DRAFT } from './helpers/fakeServices';

describe('parseModelJson', () => {
  it('parses plain JSON, fenced JSON and JSON surrounded by chatter', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseModelJson('Here you go: {"a":1} hope that helps')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('reports non-JSON as invalid', () => {
    expect(parseModelJson('I think this is an 8').ok).toBe(false);
  });
});

describe('validateScoreResult', () => {
  it('accepts a whole number 0-10 with a reason', () => {
    expect(validateScoreResult({ score: 0, reason: 'A reminder.' })).toEqual({ ok: true, value: { score: 0, reason: 'A reminder.' } });
    expect(validateScoreResult({ score: 10, reason: ' Sharp.  ' })).toEqual({ ok: true, value: { score: 10, reason: 'Sharp.' } });
  });
  it.each([
    [{ score: 11, reason: 'x' }],
    [{ score: -1, reason: 'x' }],
    [{ score: 7.5, reason: 'x' }],
    [{ score: '8', reason: 'x' }],
    [{ score: 8 }],
    [{ score: 8, reason: '' }],
    [[8, 'reason']],
    [null],
  ])('rejects %j', (value) => {
    expect(validateScoreResult(value).ok).toBe(false);
  });
});

describe('validateKeywordResult', () => {
  it('cleans, de-duplicates and caps keywords at 5', () => {
    const result = validateKeywordResult({
      keywords: ['niacinamide', ' niacinamide ', 'pH', '', 'label claims', 'stability', 'penetration', 'extra'],
      search_query: '"niacinamide label claims"',
    });
    expect(result).toEqual({
      ok: true,
      value: { keywords: ['niacinamide', 'pH', 'label claims', 'stability', 'penetration'], searchQuery: 'niacinamide label claims' },
    });
  });
  it.each([[{ keywords: 'niacinamide', search_query: 'x' }], [{ keywords: [], search_query: 'x' }], [{ keywords: ['a'], search_query: '' }], [{ keywords: ['a'] }]])(
    'rejects %j',
    (value) => {
      expect(validateKeywordResult(value).ok).toBe(false);
    },
  );
});

describe('validateRelevanceResult', () => {
  it('accepts "not relevant" without an article number', () => {
    expect(validateRelevanceResult({ relevant: false, article_number: null, reason: 'Off topic.' }, 3)).toEqual({
      ok: true,
      value: { relevant: false, articleNumber: null, reason: 'Off topic.' },
    });
  });
  it('requires a valid article number when relevant', () => {
    expect(validateRelevanceResult({ relevant: true, article_number: 2, reason: 'On point.' }, 3).ok).toBe(true);
    expect(validateRelevanceResult({ relevant: true, article_number: 4, reason: 'On point.' }, 3).ok).toBe(false);
    expect(validateRelevanceResult({ relevant: true, reason: 'On point.' }, 3).ok).toBe(false);
  });
  it('requires a real boolean', () => {
    expect(validateRelevanceResult({ relevant: 'true', article_number: 1, reason: 'x' }, 3).ok).toBe(false);
  });
});

describe('validateDraftText', () => {
  it('accepts a full draft and strips wrapping', () => {
    expect(validateDraftText(`\`\`\`\n${SAMPLE_DRAFT}\n\`\`\``)).toEqual({ ok: true, value: SAMPLE_DRAFT });
  });
  it('rejects empty and truncated drafts', () => {
    expect(validateDraftText('   ').ok).toBe(false);
    expect(validateDraftText('Short draft.').ok).toBe(false);
  });
});

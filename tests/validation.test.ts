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
  // There is no "score" field to send any more - it's always the sum of the
  // three criteria's marks, so the number and the breakdown can never disagree.
  const fullBreakdown = [
    { criterion: 'idea', marks: 4, verdict: 'Clear, specific gap' },
    { criterion: 'specificity', marks: 2, verdict: 'Names an exact number' },
    { criterion: 'fit', marks: 2, verdict: 'Right in her territory' },
  ];

  it('computes the score as the sum of the marks, in the fixed idea/specificity/fit order regardless of input order', () => {
    const result = validateScoreResult({
      reason: 'Strong.',
      breakdown: [fullBreakdown[2], fullBreakdown[0], fullBreakdown[1]], // shuffled on purpose
    });
    expect(result).toEqual({
      ok: true,
      value: {
        score: 8, // 4 + 2 + 2
        reason: 'Strong.',
        breakdown: [
          { criterion: 'idea', marks: 4, maxMarks: 5, verdict: 'Clear, specific gap' },
          { criterion: 'specificity', marks: 2, maxMarks: 3, verdict: 'Names an exact number' },
          { criterion: 'fit', marks: 2, maxMarks: 2, verdict: 'Right in her territory' },
        ],
      },
    });
  });

  it('accepts the extremes: all-zero and all-max marks', () => {
    const zeroed = validateScoreResult({
      reason: 'x',
      breakdown: [{ criterion: 'idea', marks: 0, verdict: 'a' }, { criterion: 'specificity', marks: 0, verdict: 'b' }, { criterion: 'fit', marks: 0, verdict: 'c' }],
    });
    expect(zeroed.ok && zeroed.value.score).toBe(0);

    const maxed = validateScoreResult({
      reason: 'x',
      breakdown: [{ criterion: 'idea', marks: 5, verdict: 'a' }, { criterion: 'specificity', marks: 3, verdict: 'b' }, { criterion: 'fit', marks: 2, verdict: 'c' }],
    });
    expect(maxed.ok && maxed.value.score).toBe(10);
  });

  it.each([
    ['a missing criterion', [fullBreakdown[0], fullBreakdown[1]]],
    ['an unknown criterion', [{ criterion: 'tone', marks: 3, verdict: 'x' }, fullBreakdown[1], fullBreakdown[2]]],
    ['marks above the criterion\'s max', [{ criterion: 'idea', marks: 9, verdict: 'x' }, fullBreakdown[1], fullBreakdown[2]]],
    ['negative marks', [{ criterion: 'idea', marks: -1, verdict: 'x' }, fullBreakdown[1], fullBreakdown[2]]],
    ['non-integer marks', [{ criterion: 'idea', marks: 2.5, verdict: 'x' }, fullBreakdown[1], fullBreakdown[2]]],
    ['a missing verdict', [{ criterion: 'idea', marks: 4 }, fullBreakdown[1], fullBreakdown[2]]],
    ['breakdown not an array', 'not an array'],
    ['breakdown missing entirely', undefined],
  ])('rejects %s - the score can never be computed from it', (_label, breakdown) => {
    expect(validateScoreResult({ reason: 'x', breakdown }).ok).toBe(false);
  });

  it.each([
    [{ reason: '', breakdown: fullBreakdown }],
    [{ breakdown: fullBreakdown }],
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

/**
 * End-to-end tests of the note pipeline, from a Telegram update to the
 * database and the reply - with Gemini, Google News and Telegram faked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/database', () => import('./helpers/fakeDatabase'));
vi.mock('@/lib/claude', () => ({ generateTextWithClaude: vi.fn() }));

import { generateTextWithClaude } from '@/lib/claude';
import { db, resetDatabase } from './helpers/fakeDatabase';
import {
  calls,
  deliver,
  installFakeServices,
  replies,
  rssFeed,
  SAMPLE_DRAFT,
  sentTexts,
  STRONG_NOTE,
  telegramTextUpdate,
  WEAK_NOTE,
} from './helpers/fakeServices';

const relevantFeed = rssFeed([
  { title: 'Regulator questions skincare percentage claims on labels', source: 'Business Standard', daysAgo: 3 },
  { title: 'Celebrity launches new serum line', source: 'Style Weekly', daysAgo: 5 },
]);

beforeEach(() => {
  resetDatabase();
  process.env.DRAFTING_PROVIDER = 'gemini';
  process.env.ANTHROPIC_API_KEY = '';
});

describe('Test 1 - strong note', () => {
  it('scores >= 6, generates a draft, saves it as pending and sends it to Telegram', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
      news: { xml: relevantFeed },
    });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    expect(db.notes).toHaveLength(1);
    expect(db.notes[0]).toMatchObject({ raw_text: STRONG_NOTE, score: 8, status: 'drafted', search_query: 'niacinamide label claims' });
    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0]).toMatchObject({ note_id: 1, status: 'pending', news_used: false, model_used: 'gemini-test', voice_skill_version: 1 });
    expect(db.drafts[0].telegram_message_ids?.length).toBeGreaterThan(0);

    const draftMessage = sentTexts().find((t) => t.startsWith('DRAFT READY'));
    expect(draftMessage).toContain('Reply APPROVE or REJECT. Nothing is published automatically.');
    expect(draftMessage).not.toContain('NEWS SOURCE');
  });

  it('shows the score breakdown with marks that add up to the total', async () => {
    installFakeServices({
      gemini: {
        scoring: [replies.strongScore],
        keywords: [replies.keywords],
        relevance: [replies.notRelevant],
        drafting: [SAMPLE_DRAFT],
      },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.notes[0].score).toBe(8); // 4 + 2 + 2, computed - never asserted separately by the model
    const message = sentTexts().find((t) => t.startsWith('DRAFT READY'))!;
    expect(message).toContain('Score 8/10');
    expect(message).toContain('- Idea (4/5): Sharp label-vs-performance gap');
    expect(message).toContain('- Specificity (2/3): Names the exact ingredient and number');
    expect(message).toContain('- Fit (2/2): Right in her formulation expertise');
  });

  it('sends the stored Voice Skill to the drafting model', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    const draftingCall = calls.gemini.find((c) => c.task === 'drafting');
    expect(draftingCall?.system).toContain('<voice_skill>');
    expect(draftingCall?.system).toContain('MASTER VOICE PROMPT: WRITING IN THE VOICE OF MEERA PILLAI');
    expect(draftingCall?.user).toContain(STRONG_NOTE);
  });
});

describe('Test 2 - weak note', () => {
  it('scores < 6, creates no draft, marks the note rejected and explains why', async () => {
    installFakeServices({ gemini: { scoring: [replies.weakScore] } });

    await deliver(telegramTextUpdate(WEAK_NOTE));

    expect(db.notes[0]).toMatchObject({ status: 'rejected', score: 0 }); // 0 + 0 + 0, computed
    expect(db.drafts).toHaveLength(0);
    expect(calls.gemini.map((c) => c.task)).toEqual(['scoring']); // no keywords, news or drafting
    expect(calls.news).toHaveLength(0);
    const [message] = sentTexts();
    expect(message).toContain("This one isn't strong enough to develop into a post yet.");
    expect(message).toContain('Score: 0/10');
    expect(message).toContain('Reason: A to-do reminder with no idea to develop.');
    expect(message).toContain("I've saved the note, but I haven't drafted it.");
  });

  it('shows the score breakdown on a rejected note too', async () => {
    installFakeServices({ gemini: { scoring: [replies.weakScore] } });
    await deliver(telegramTextUpdate(WEAK_NOTE));
    const [message] = sentTexts();
    expect(message).toContain('- Idea (0/5): No idea, just a logistics task');
    expect(message).toContain('- Specificity (0/3): Nothing to anchor a post to');
    expect(message).toContain('- Fit (0/2): Not a content topic at all');
  });
});

describe('Test 3 - news relevance', () => {
  it('uses a relevant article and appends the verification block', async () => {
    installFakeServices({
      gemini: {
        scoring: [replies.strongScore],
        keywords: [replies.keywords],
        relevance: [replies.relevantFirst],
        drafting: [`${SAMPLE_DRAFT}\n\nNEWS_USED: YES`],
      },
      news: { xml: relevantFeed },
    });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    expect(db.drafts[0]).toMatchObject({
      news_used: true,
      news_headline: 'Regulator questions skincare percentage claims on labels',
      news_source: 'Business Standard',
    });
    expect(db.drafts[0].draft_text).not.toContain('NEWS_USED');
    const message = sentTexts().find((t) => t.startsWith('DRAFT READY'))!;
    expect(message).toContain('NEWS SOURCE: Regulator questions skincare percentage claims on labels');
    expect(message).toMatch(/FROM: Business Standard · \d{1,2} \w+ \d{4}/);
    expect(message).toContain('LINK: https://news.google.com/rss/articles/test-0');
    expect(message).toContain('⚠ Check this before publishing — you are the author of this claim');

    const draftingCall = calls.gemini.find((c) => c.task === 'drafting')!;
    expect(draftingCall.user).toContain('CURRENT NEWS ITEM');
  });

  it('ignores an irrelevant article - no news in the prompt, no source block', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
      news: { xml: relevantFeed },
    });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    expect(db.drafts[0].news_used).toBe(false);
    expect(db.drafts[0].news_headline).toBeNull();
    expect(db.drafts[0].news_relevance_reason).toContain('not about');
    expect(calls.gemini.find((c) => c.task === 'drafting')!.user).toContain('No news item is attached');
    const message = sentTexts().find((t) => t.startsWith('DRAFT READY'))!;
    expect(message).not.toContain('NEWS SOURCE');
    // A search DID run - Meera should see that it was checked and why nothing was used, not silence.
    expect(message).toContain('News: searched "niacinamide label claims" - Same industry, but not about the note\'s point.');
    expect(message).toContain('Drafted from your note alone.');
  });

  it('says nothing about news when it was never searched (e.g. keyword extraction failed)', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: ['not json', 'still not json'], drafting: [SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    const message = sentTexts().find((t) => t.startsWith('DRAFT READY'))!;
    expect(message).not.toContain('News:');
    expect(message).not.toContain('NEWS SOURCE');
  });

  it('drops the source block if the drafter says it did not use the news', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.relevantFirst], drafting: [`${SAMPLE_DRAFT}\nNEWS_USED: NO`] },
      news: { xml: relevantFeed },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.drafts[0].news_used).toBe(false);
    expect(sentTexts().join('\n')).not.toContain('NEWS SOURCE');
  });

  it('still drafts (without news) when Google News is down', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], drafting: [SAMPLE_DRAFT] },
      news: { status: 503 },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.notes[0].status).toBe('drafted');
    expect(db.drafts[0]).toMatchObject({ status: 'pending', news_used: false, news_relevance_reason: 'News search failed' });
    expect(calls.gemini.some((c) => c.task === 'relevance')).toBe(false);
  });

  it('skips the relevance check when there are no recent articles', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], drafting: [SAMPLE_DRAFT] },
      news: { xml: rssFeed([{ title: 'Old story about niacinamide', source: 'Old News', daysAgo: 90 }]) },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(calls.gemini.some((c) => c.task === 'relevance')).toBe(false);
    expect(db.drafts[0].news_used).toBe(false);
  });
});

describe('Test 6 - duplicate webhook', () => {
  it('creates one note and runs the pipeline once when Telegram sends the same message twice', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    const update = telegramTextUpdate(STRONG_NOTE, { messageId: 777 });

    await deliver(update);
    await deliver(update);

    expect(db.notes).toHaveLength(1);
    expect(db.drafts).toHaveLength(1);
    expect(calls.gemini.filter((c) => c.task === 'scoring')).toHaveLength(1);
    expect(sentTexts().filter((t) => t.startsWith('DRAFT READY'))).toHaveLength(1);
  });

  it('is also safe when both copies arrive at the same moment', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    const update = telegramTextUpdate(STRONG_NOTE, { messageId: 778 });
    await Promise.all([deliver(update), deliver(update)]);
    expect(db.notes).toHaveLength(1);
    expect(db.drafts).toHaveLength(1);
  });
});

describe('Test 7 - malformed AI response', () => {
  it('retries once with a stricter prompt and continues when the retry is valid', async () => {
    installFakeServices({
      gemini: { scoring: ['Sure! I would rate this an 8 out of 10.', replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    const scoringCalls = calls.gemini.filter((c) => c.task === 'scoring');
    expect(scoringCalls).toHaveLength(2);
    expect(scoringCalls[1].user).toContain('IMPORTANT: your previous answer could not be used');
    expect(db.notes[0]).toMatchObject({ score: 8, status: 'drafted' });
  });

  it('rejects an incomplete or out-of-range score breakdown as invalid', async () => {
    installFakeServices({
      gemini: {
        // Attempt 1: only one of the three required criteria.
        // Attempt 2 (retry): all three present, but "idea" exceeds its 0-5 max.
        scoring: [
          '{"reason": "Great", "breakdown": [{"criterion": "idea", "marks": 5, "verdict": "x"}]}',
          '{"reason": "Good", "breakdown": [{"criterion": "idea", "marks": 9, "verdict": "x"}, {"criterion": "specificity", "marks": 1, "verdict": "y"}, {"criterion": "fit", "marks": 1, "verdict": "z"}]}',
        ],
      },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.notes[0].status).toBe('error');
    expect(db.notes[0].score).toBeNull();
  });

  it('marks the note as error and sends a simple message when the retry is also malformed', async () => {
    installFakeServices({ gemini: { scoring: ['not json', '{"score": "high"}'] } });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    expect(db.notes[0].status).toBe('error');
    expect(db.notes[0].error_message).toContain('AiOutputError');
    expect(db.drafts).toHaveLength(0);
    const texts = sentTexts();
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('Something went wrong while working on this note');
    expect(texts[0]).not.toContain('not json');
    expect(texts[0]).not.toContain('AiOutputError');
  });

  it('retries a draft that is far too short, then accepts the valid one', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: ['Too short.', SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(calls.gemini.filter((c) => c.task === 'drafting')).toHaveLength(2);
    expect(db.drafts[0].status).toBe('pending');
  });

  it('treats a failed keyword step as "no news", not as a failed note', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: ['{"keywords": []}', '{"nope": 1}'], drafting: [SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.notes[0].status).toBe('drafted');
    expect(calls.news).toHaveLength(0);
  });
});

describe('Other failures', () => {
  it('handles a Gemini outage without crashing or saving a draft', async () => {
    installFakeServices({ gemini: { scoring: [{ status: 401 }] } });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.notes[0].status).toBe('error');
    expect(db.notes[0].error_message).toContain('GEMINI_API_KEY');
    expect(sentTexts()[0]).toContain('Something went wrong');
    expect(sentTexts()[0]).not.toContain('GEMINI');
  });

  it('marks the draft as error (not pending) if Telegram cannot deliver it, so APPROVE cannot approve it unseen', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
      telegramSendFailure: 400,
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.drafts[0].status).toBe('error');
    expect(db.notes[0].status).toBe('error');
  });

  it('tells Meera when the note could not be saved because Supabase is down', async () => {
    installFakeServices({ gemini: {} });
    db.failing = true;
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(calls.gemini).toHaveLength(0);
    expect(sentTexts()[0]).toContain("couldn't save that note");
  });

  it('falls back to Gemini when Claude drafting fails, and records which model wrote it', async () => {
    process.env.DRAFTING_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-1234567890';
    vi.mocked(generateTextWithClaude).mockRejectedValue(new Error('overloaded'));
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(generateTextWithClaude).toHaveBeenCalled();
    expect(db.drafts[0].model_used).toBe('gemini-test (fallback)');
  });

  it('uses Claude for drafting when it is configured', async () => {
    process.env.DRAFTING_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key-1234567890';
    vi.mocked(generateTextWithClaude).mockResolvedValue(SAMPLE_DRAFT);
    installFakeServices({ gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant] } });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.drafts[0].model_used).toBe('claude-opus-5');
    expect(calls.gemini.some((c) => c.task === 'drafting')).toBe(false);
  });

  it('never calls anything that could publish', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    await deliver(telegramTextUpdate('APPROVE'));
    // The only outbound calls are Gemini, Google News and Telegram - fakeServices throws on anything else.
    expect(calls.telegram.every((c) => ['sendMessage', 'sendChatAction'].includes(c.method))).toBe(true);
  });
});

describe('ready-to-use drafts (no leftover placeholders)', () => {
  it('drops the whole paragraph if the model leaves a placeholder in it - the delivered draft has no bracket text and no "TO FILL IN" line', async () => {
    const draftWithPlaceholder = [
      SAMPLE_DRAFT,
      'At Skinstinct, we [COMPANY PRACTICE NEEDED: how we handle this]. We do this because it matters to customers.',
    ].join('\n\n');
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [draftWithPlaceholder] },
    });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    expect(db.drafts[0].draft_text).not.toContain('[COMPANY PRACTICE NEEDED');
    expect(db.drafts[0].draft_text).not.toContain('We do this because it matters to customers');
    expect(db.drafts[0].draft_text).toContain(SAMPLE_DRAFT.split('\n\n')[0]); // the rest of the post survives intact
    const message = sentTexts().find((t) => t.startsWith('DRAFT READY'))!;
    expect(message).not.toContain('[COMPANY PRACTICE NEEDED');
    expect(message).not.toContain('TO FILL IN');
  });

  it('leaves a normal draft (no placeholder) completely untouched', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.drafts[0].draft_text).toBe(SAMPLE_DRAFT);
  });
});

/**
 * Before Supabase is connected: scoring, news and drafting still work, nothing
 * is written anywhere, the bot never claims to have saved anything, and
 * APPROVE / REJECT explain that they need the database.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/database', () => import('./helpers/fakeDatabase'));

import { db, resetDatabase } from './helpers/fakeDatabase';
import {
  calls,
  deliver,
  installFakeServices,
  replies,
  SAMPLE_DRAFT,
  sentTexts,
  STRONG_NOTE,
  telegramTextUpdate,
  WEAK_NOTE,
} from './helpers/fakeServices';

const savedEnv = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };

beforeEach(() => {
  resetDatabase();
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  // If anything tried to use the database, the fake would throw.
  db.failing = true;
});

afterAll(() => {
  process.env.SUPABASE_URL = savedEnv.url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = savedEnv.key;
});

describe('without Supabase', () => {
  it('still scores, drafts with the voice file, and delivers the draft - clearly marked as not saved', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    const draftMessage = sentTexts().find((t) => t.startsWith('DRAFT READY'))!;
    expect(draftMessage).toContain('DRAFT READY (not saved)');
    expect(draftMessage).toContain(SAMPLE_DRAFT.slice(0, 60));
    expect(draftMessage).toContain('APPROVE / REJECT are off until the database is connected');
    expect(draftMessage).not.toContain('APPROVE → mark this draft approved');
    expect(calls.gemini.find((c) => c.task === 'drafting')?.system).toContain('MASTER VOICE PROMPT');
    expect(db.notes).toHaveLength(0);
    expect(db.drafts).toHaveLength(0);
  });

  it('rejects weak notes without claiming they were saved', async () => {
    installFakeServices({ gemini: { scoring: [replies.weakScore] } });
    await deliver(telegramTextUpdate(WEAK_NOTE));
    const [message] = sentTexts();
    expect(message).toContain("This one isn't strong enough to develop into a post yet.");
    expect(message).toContain("wasn't saved");
    expect(message).not.toContain("I've saved the note");
  });

  it('processes a repeated delivery only once', async () => {
    installFakeServices({
      gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
    });
    const update = telegramTextUpdate(STRONG_NOTE, { messageId: 3131 });
    await deliver(update);
    await deliver(update);
    expect(calls.gemini.filter((c) => c.task === 'scoring')).toHaveLength(1);
    expect(sentTexts().filter((t) => t.startsWith('DRAFT READY'))).toHaveLength(1);
  });

  it('answers APPROVE / REJECT with an explanation instead of failing', async () => {
    installFakeServices({ gemini: {} });
    await deliver(telegramTextUpdate('APPROVE'));
    await deliver(telegramTextUpdate('REJECT'));
    expect(sentTexts()).toEqual([
      "APPROVE and REJECT need the database, which isn't connected yet - so nothing was recorded. Nothing is ever published automatically.",
      "APPROVE and REJECT need the database, which isn't connected yet - so nothing was recorded. Nothing is ever published automatically.",
    ]);
  });

  it('says in /start that the database is not connected', async () => {
    installFakeServices({ gemini: {} });
    await deliver(telegramTextUpdate('/start'));
    expect(sentTexts()[0]).toContain("the database isn't connected");
  });

  it('reports errors honestly', async () => {
    installFakeServices({ gemini: { scoring: ['not json', 'still not json'] } });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(sentTexts()[0]).toContain('Something went wrong while working on this note');
    expect(sentTexts()[0]).not.toContain('The note is saved');
  });
});

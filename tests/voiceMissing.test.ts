/** With no voice profile anywhere, the pipeline must not draft generic content. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/database', () => import('./helpers/fakeDatabase'));
// Pretend voice-skill.txt does not exist.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  readFileSync: () => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  },
}));

import { db, resetDatabase } from './helpers/fakeDatabase';
import { calls, deliver, installFakeServices, replies, sentTexts, STRONG_NOTE, telegramTextUpdate } from './helpers/fakeServices';

beforeEach(() => resetDatabase());

describe('missing voice skill', () => {
  it('stops before drafting, marks the note as error, and tells Meera why', async () => {
    installFakeServices({ gemini: { scoring: [replies.strongScore] } });

    await deliver(telegramTextUpdate(STRONG_NOTE));

    expect(db.notes[0]).toMatchObject({ status: 'error', score: 8 });
    expect(db.drafts).toHaveLength(0);
    expect(calls.gemini.map((c) => c.task)).toEqual(['scoring']);
    expect(sentTexts()[0]).toContain("I couldn't find your voice profile");
  });

  it('uses the Supabase profile when the file is missing', async () => {
    db.voice.push({
      id: 1,
      profile_text: 'Voice profile from the database. '.repeat(40),
      version: 3,
      is_active: true,
      source: 'manual',
      created_at: '',
      updated_at: '',
    });
    installFakeServices({
      gemini: {
        scoring: [replies.strongScore],
        keywords: [replies.keywords],
        relevance: [replies.notRelevant],
        drafting: [(await import('./helpers/fakeServices')).SAMPLE_DRAFT],
      },
    });
    await deliver(telegramTextUpdate(STRONG_NOTE));
    expect(db.drafts[0].voice_skill_version).toBe(3);
    expect(calls.gemini.find((c) => c.task === 'drafting')?.system).toContain('Voice profile from the database.');
  });
});

/** APPROVE / REJECT: status changes, history kept, nothing published. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/database', () => import('./helpers/fakeDatabase'));

import { parseCommand } from '@/lib/commands';
import { db, resetDatabase } from './helpers/fakeDatabase';
import { calls, deliver, installFakeServices, replies, SAMPLE_DRAFT, sentTexts, STRONG_NOTE, telegramTextUpdate } from './helpers/fakeServices';

async function createPendingDraft() {
  installFakeServices({
    gemini: { scoring: [replies.strongScore], keywords: [replies.keywords], relevance: [replies.notRelevant], drafting: [SAMPLE_DRAFT] },
  });
  await deliver(telegramTextUpdate(STRONG_NOTE));
  expect(db.drafts.at(-1)?.status).toBe('pending');
  calls.telegram = [];
}

beforeEach(() => resetDatabase());

describe('Test 4 - APPROVE', () => {
  it('marks the latest pending draft approved, sets approved_at, and does not publish', async () => {
    await createPendingDraft();

    await deliver(telegramTextUpdate('APPROVE'));

    expect(db.drafts[0].status).toBe('approved');
    expect(db.drafts[0].approved_at).not.toBeNull();
    expect(db.notes).toHaveLength(1); // the command was not saved as a note
    const texts = sentTexts();
    expect(texts[0]).toContain("Approved and saved. I haven't published it — you remain the final publisher.");
    expect(texts[1]).toContain('Copy-ready text:');
    expect(texts[1]).toContain(SAMPLE_DRAFT);
  });

  it('accepts lower case, punctuation and the /approve form', async () => {
    await createPendingDraft();
    await deliver(telegramTextUpdate('  approve. '));
    expect(db.drafts[0].status).toBe('approved');
  });

  it('can target a specific draft by number or by replying to it', async () => {
    await createPendingDraft();
    await createPendingDraft();
    const firstDraftMessageId = db.drafts[0].telegram_message_ids![0];

    await deliver(telegramTextUpdate('APPROVE', { replyTo: firstDraftMessageId }));
    expect(db.drafts.map((d) => d.status)).toEqual(['approved', 'pending']);

    await deliver(telegramTextUpdate('REJECT 2'));
    expect(db.drafts.map((d) => d.status)).toEqual(['approved', 'rejected']);
  });

  it('says so when there is nothing pending', async () => {
    installFakeServices({ gemini: {} });
    await deliver(telegramTextUpdate('APPROVE'));
    expect(sentTexts()[0]).toBe("There's no pending draft to approve right now.");
  });

  it('does not change an already-decided draft', async () => {
    await createPendingDraft();
    await deliver(telegramTextUpdate('REJECT'));
    await deliver(telegramTextUpdate('APPROVE 1'));
    expect(db.drafts[0].status).toBe('rejected');
    expect(sentTexts().at(-1)).toBe("Draft #1 is already rejected. I haven't changed it.");
  });

  it('applies a duplicated APPROVE delivery only once', async () => {
    await createPendingDraft();
    const approve = telegramTextUpdate('APPROVE', { messageId: 4242 });
    await deliver(approve);
    await deliver(approve);
    expect(db.drafts[0].status).toBe('approved');
    expect(sentTexts().filter((t) => t.startsWith('Approved and saved'))).toHaveLength(1);
  });
});

describe('Test 5 - REJECT', () => {
  it('marks the draft rejected and keeps both the note and the draft', async () => {
    await createPendingDraft();

    await deliver(telegramTextUpdate('REJECT'));

    expect(db.drafts).toHaveLength(1);
    expect(db.drafts[0]).toMatchObject({ status: 'rejected', draft_text: SAMPLE_DRAFT });
    expect(db.drafts[0].rejected_at).not.toBeNull();
    expect(db.notes).toHaveLength(1);
    expect(db.notes[0].raw_text).toBe(STRONG_NOTE);
    expect(sentTexts()[0]).toContain('Rejected and saved. The note and draft remain in the archive.');
  });
});

describe('parseCommand', () => {
  it.each([
    ['APPROVE', { type: 'approve', draftId: null }],
    ['approve', { type: 'approve', draftId: null }],
    ['/approve', { type: 'approve', draftId: null }],
    ['Approve!', { type: 'approve', draftId: null }],
    ['REJECT 12', { type: 'reject', draftId: 12 }],
    ['reject #7', { type: 'reject', draftId: 7 }],
    ['/start', { type: 'help' }],
    ['/help', { type: 'help' }],
  ])('recognises %j', (text, expected) => {
    expect(parseCommand(text)).toEqual(expected);
  });

  it.each(['Approve the new supplier contract', 'reject list for packaging vendors', 'I approve of this idea', ''])(
    'treats %j as a note, not a command',
    (text) => {
      expect(parseCommand(text)).toBeNull();
    },
  );
});

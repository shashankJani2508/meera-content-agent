/** Telegram payload validation, message splitting, unsupported types and access control. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/database', () => import('./helpers/fakeDatabase'));

import { parseTelegramUpdate, splitMessage } from '@/lib/telegram';
import { db, resetDatabase } from './helpers/fakeDatabase';
import { calls, deliver, installFakeServices, replies, sentTexts, TELEGRAM_CHAT_ID, telegramTextUpdate } from './helpers/fakeServices';

beforeEach(() => {
  resetDatabase();
  process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
});

describe('parseTelegramUpdate', () => {
  it('extracts chat ID, user ID, message ID, text and timestamp from a private message', () => {
    const parsed = parseTelegramUpdate(telegramTextUpdate('hello', { messageId: 55 }));
    expect(parsed.kind).toBe('text');
    if (parsed.kind !== 'text') return;
    expect(parsed.message).toMatchObject({ chatId: TELEGRAM_CHAT_ID, userId: TELEGRAM_CHAT_ID, messageId: 55, text: 'hello', source: 'private_chat' });
    expect(parsed.message.sentAt).toBeInstanceOf(Date);
  });

  it('supports posts in a channel the bot administers (no sender user)', () => {
    const parsed = parseTelegramUpdate({
      update_id: 1,
      channel_post: { message_id: 9, date: 1_700_000_000, chat: { id: -1001234567890, type: 'channel' }, text: 'note' },
    });
    expect(parsed.kind).toBe('text');
    if (parsed.kind === 'text') expect(parsed.message).toMatchObject({ chatId: -1001234567890, userId: null, source: 'channel' });
  });

  it.each([
    [null, 'invalid'],
    [{}, 'invalid'],
    [{ update_id: 1, message: { chat: { id: 1 }, date: 1 } }, 'invalid'],
    [{ update_id: 1, message: 'text' }, 'invalid'],
    [{ update_id: 1, edited_message: { message_id: 1 } }, 'ignored'],
    [{ update_id: 1, callback_query: {} }, 'ignored'],
    [{ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1 }, new_chat_members: [] } }, 'ignored'],
    [{ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1 }, voice: { file_id: 'x' } } }, 'unsupported'],
    [{ update_id: 1, message: { message_id: 1, date: 1, chat: { id: 1 }, photo: [] } }, 'unsupported'],
  ])('classifies %j as %s', (payload, kind) => {
    expect(parseTelegramUpdate(payload).kind).toBe(kind);
  });
});

describe('splitMessage', () => {
  it('keeps short messages whole and splits long ones on paragraph boundaries under the limit', () => {
    expect(splitMessage('short', 100)).toEqual(['short']);
    const paragraphs = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} `.repeat(10).trim());
    const chunks = splitMessage(paragraphs.join('\n\n'), 300);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 300)).toBe(true);
    expect(chunks.join('\n\n')).toBe(paragraphs.join('\n\n'));
  });
});

describe('webhook handling of unusual messages', () => {
  it('replies to unsupported types (e.g. a voice note) without saving a note', async () => {
    installFakeServices({ gemini: {} });
    await deliver({ update_id: 5, message: { message_id: 5, date: 1, chat: { id: TELEGRAM_CHAT_ID, type: 'private' }, voice: { file_id: 'x' } } });
    expect(db.notes).toHaveLength(0);
    expect(sentTexts()[0]).toContain('I can only work with text notes for now');
  });

  it('ignores empty and whitespace-only messages', async () => {
    installFakeServices({ gemini: {} });
    await deliver(telegramTextUpdate('   '));
    expect(db.notes).toHaveLength(0);
    expect(calls.telegram).toHaveLength(0);
  });

  it('answers /start with help and the chat ID, without saving a note', async () => {
    installFakeServices({ gemini: {} });
    await deliver(telegramTextUpdate('/start'));
    expect(db.notes).toHaveLength(0);
    expect(sentTexts()[0]).toContain(`This chat's ID: ${TELEGRAM_CHAT_ID}`);
    expect(sentTexts()[0]).toContain('Nothing is ever published automatically.');
  });

  it('refuses chats that are not on the allow-list', async () => {
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = '999, 888';
    installFakeServices({ gemini: {} });
    await deliver(telegramTextUpdate('A real note about pH and stability.'));
    expect(db.notes).toHaveLength(0);
    expect(calls.gemini).toHaveLength(0);
    expect(sentTexts()[0]).toBe(`This is a private bot. (Chat ID: ${TELEGRAM_CHAT_ID})`);
  });

  it("never treats the bot's own channel posts as notes (loop guard)", async () => {
    installFakeServices({ gemini: {} });
    const channelPost = (text: string, id: number) => ({
      update_id: id,
      channel_post: { message_id: id, date: 1_700_000_000, chat: { id: -1001234567890, type: 'channel' }, text },
    });
    await deliver(channelPost('DRAFT READY · #3\n\nScore 8/10 · 420 words\n\nThe number on the front...', 71));
    await deliver(channelPost('Copy-ready text:\n\nThe number on the front...', 72));
    expect(db.notes).toHaveLength(0);
    expect(calls.gemini).toHaveLength(0);
  });

  it('still accepts normal notes posted in a channel', async () => {
    installFakeServices({ gemini: { scoring: [replies.weakScore] } });
    await deliver({
      update_id: 73,
      channel_post: { message_id: 73, date: 1_700_000_000, chat: { id: -1001234567890, type: 'channel' }, text: 'sunscreen post?' },
    });
    expect(db.notes).toHaveLength(1);
    expect(db.notes[0].user_id).toBeNull();
  });

  it('accepts chats that are on the allow-list', async () => {
    process.env.TELEGRAM_ALLOWED_CHAT_IDS = `999,${TELEGRAM_CHAT_ID}`;
    installFakeServices({ gemini: { scoring: [replies.weakScore] } });
    await deliver(telegramTextUpdate('sunscreen post?'));
    expect(db.notes).toHaveLength(1);
  });
});

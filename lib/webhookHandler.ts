/**
 * What happens when Telegram delivers an update:
 *
 *   validate payload → check the chat is allowed → command? handle it
 *   → otherwise save the note (duplicates stop here) → run the pipeline
 *     in the background so Telegram gets its "200 OK" straight away.
 */
import { handleCommand, parseCommand } from './commands';
import { getTelegramConfig, isDatabaseConfigured } from './config';
import { insertNote } from './database';
import { log, preview } from './logger';
import * as messages from './messages';
import { processNote } from './pipeline';
import { parseTelegramUpdate, sendMessageSafely } from './telegram';
import type { IncomingMessage, NoteRow } from './types';

/** Runs work after the HTTP response is sent (Next.js `after()` in production). */
export type BackgroundRunner = (task: () => Promise<void>) => void;

function isChatAllowed(chatId: number): boolean {
  const { allowedChatIds } = getTelegramConfig();
  if (allowedChatIds.size === 0) {
    log.warn('WEBHOOK', 'TELEGRAM_ALLOWED_CHAT_IDS is empty - accepting every chat. Set it once you know your chat ID.');
    return true;
  }
  return allowedChatIds.has(String(chatId));
}

/**
 * Without Supabase there is no database to catch repeated deliveries, so we
 * remember recent message IDs in memory. This only covers one server
 * instance - good enough until the database is connected.
 */
const recentlySeenMessages = new Set<string>();
const MAX_REMEMBERED_MESSAGES = 500;

function unsavedNote(message: IncomingMessage & { text: string }): NoteRow | null {
  const key = `${message.chatId}:${message.messageId}`;
  if (recentlySeenMessages.has(key)) {
    log.info('WEBHOOK', 'Duplicate delivery - already processing this message, ignoring', { chatId: message.chatId, messageId: message.messageId });
    return null;
  }
  recentlySeenMessages.add(key);
  if (recentlySeenMessages.size > MAX_REMEMBERED_MESSAGES) {
    recentlySeenMessages.delete(recentlySeenMessages.values().next().value as string);
  }
  log.warn('DATABASE', 'Supabase is not configured - processing this note without saving it');
  const now = new Date().toISOString();
  return {
    id: 0,
    telegram_chat_id: message.chatId,
    telegram_message_id: message.messageId,
    user_id: message.userId,
    raw_text: message.text.trim(),
    score: null,
    score_reason: null,
    search_keywords: null,
    search_query: null,
    status: 'received',
    error_message: null,
    telegram_sent_at: message.sentAt.toISOString(),
    created_at: now,
    updated_at: now,
  };
}

async function saveIncomingNote(message: IncomingMessage & { text: string }): Promise<NoteRow | null> {
  if (!isDatabaseConfigured()) return unsavedNote(message);
  try {
    const result = await insertNote({
      telegram_chat_id: message.chatId,
      telegram_message_id: message.messageId,
      user_id: message.userId,
      raw_text: message.text.trim(),
      telegram_sent_at: message.sentAt.toISOString(),
    });
    if (result.duplicate) {
      log.info('WEBHOOK', 'Duplicate delivery - note already saved, not processing again', {
        chatId: message.chatId,
        messageId: message.messageId,
      });
      return null;
    }
    return result.note;
  } catch (error) {
    log.error('WEBHOOK', 'Could not save note', error, { chatId: message.chatId, messageId: message.messageId });
    await sendMessageSafely(message.chatId, messages.noteSaveFailed(), { replyToMessageId: message.messageId });
    return null;
  }
}

export async function handleTelegramUpdate(body: unknown, runInBackground: BackgroundRunner): Promise<void> {
  const update = parseTelegramUpdate(body);
  if (update.kind === 'invalid') {
    log.warn('WEBHOOK', 'Invalid Telegram payload ignored', { reason: update.reason });
    return;
  }
  if (update.kind === 'ignored') {
    log.info('WEBHOOK', 'Update ignored', { reason: update.reason });
    return;
  }

  const { message } = update;
  log.info('WEBHOOK', 'Message received', {
    updateId: message.updateId,
    chatId: message.chatId,
    messageId: message.messageId,
    source: message.source,
    type: update.kind === 'text' ? 'text' : update.contentType,
  });

  if (!isChatAllowed(message.chatId)) {
    log.warn('WEBHOOK', 'Message from a chat that is not allowed', { chatId: message.chatId });
    await sendMessageSafely(message.chatId, messages.notAuthorised(message.chatId));
    return;
  }

  if (update.kind === 'unsupported') {
    await sendMessageSafely(message.chatId, messages.unsupportedMessage(), { replyToMessageId: message.messageId });
    return;
  }

  const text = update.message.text.trim();
  if (!text) {
    log.info('WEBHOOK', 'Empty message ignored', { messageId: message.messageId });
    return;
  }
  if (message.source === 'channel' && messages.looksLikeBotMessage(text)) {
    log.info('WEBHOOK', "Ignored a channel post that looks like the bot's own message", { messageId: message.messageId });
    return;
  }

  const command = parseCommand(text);
  if (command) {
    log.info('COMMAND', 'Command received', { command: command.type });
    try {
      await handleCommand(message, command);
    } catch (error) {
      log.error('COMMAND', 'Command failed', error, { command: command.type });
      await sendMessageSafely(message.chatId, messages.commandFailed());
    }
    return;
  }

  const note = await saveIncomingNote(update.message);
  if (!note) return;
  log.info('WEBHOOK', 'Note saved - starting pipeline', { noteId: note.id, note: preview(note.raw_text) });
  runInBackground(() => processNote(note));
}

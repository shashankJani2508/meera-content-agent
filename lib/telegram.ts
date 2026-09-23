/**
 * Telegram Bot API: reading incoming webhook updates and sending messages back.
 * https://core.telegram.org/bots/api
 *
 * Messages are sent as plain text (no Markdown/HTML parsing), so nothing in
 * an AI draft can break the formatting or be interpreted as markup.
 */
import { getTelegramBotToken } from './config';
import { TelegramApiError } from './errors';
import { fetchWithTimeout, isTimeoutError, sleep } from './http';
import { describeError, log } from './logger';
import type { IncomingMessage } from './types';

const TELEGRAM_API_URL = 'https://api.telegram.org';
const REQUEST_TIMEOUT_MS = 15_000;
/** Telegram's hard limit is 4096 characters; stay safely under it. */
export const MAX_MESSAGE_CHARS = 3900;

// ─── Reading incoming updates ────────────────────────────────────────────────

export type ParsedUpdate =
  | { kind: 'invalid'; reason: string }
  | { kind: 'ignored'; reason: string }
  | { kind: 'unsupported'; message: IncomingMessage; contentType: string }
  | { kind: 'text'; message: IncomingMessage & { text: string } };

/** Message types Meera might send that we can't process yet (we tell her so). */
const UNSUPPORTED_CONTENT = ['voice', 'audio', 'photo', 'video', 'video_note', 'document', 'sticker', 'animation', 'location', 'contact', 'poll'];

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Check the webhook payload is structurally valid and pull out what we need.
 * Supports both a private chat with the bot ("message") and a channel the
 * bot is an admin of ("channel_post").
 */
export function parseTelegramUpdate(body: unknown): ParsedUpdate {
  if (!isObject(body) || !isInteger(body.update_id)) return { kind: 'invalid', reason: 'missing update_id' };

  if (body.edited_message || body.edited_channel_post) return { kind: 'ignored', reason: 'edited message' };
  const raw = body.message ?? body.channel_post;
  if (raw === undefined) return { kind: 'ignored', reason: 'update type not handled (no message)' };
  if (!isObject(raw)) return { kind: 'invalid', reason: 'message is not an object' };

  const chat = raw.chat;
  if (!isInteger(raw.message_id) || !isObject(chat) || !isInteger(chat.id) || !isInteger(raw.date)) {
    return { kind: 'invalid', reason: 'message is missing message_id, chat.id or date' };
  }

  const from = isObject(raw.from) ? raw.from : null;
  if (from?.is_bot === true) return { kind: 'ignored', reason: 'message from a bot' };

  const replyTo = isObject(raw.reply_to_message) && isInteger(raw.reply_to_message.message_id) ? raw.reply_to_message.message_id : null;
  const chatType = typeof chat.type === 'string' ? chat.type : '';
  const message: IncomingMessage = {
    updateId: body.update_id,
    chatId: chat.id,
    userId: from && isInteger(from.id) ? from.id : null,
    messageId: raw.message_id,
    text: typeof raw.text === 'string' ? raw.text : null,
    sentAt: new Date(raw.date * 1000),
    replyToMessageId: replyTo,
    source: chatType === 'channel' ? 'channel' : chatType === 'private' ? 'private_chat' : 'group',
  };

  if (message.text !== null) return { kind: 'text', message: { ...message, text: message.text } };
  const contentType = UNSUPPORTED_CONTENT.find((type) => type in raw);
  if (contentType) return { kind: 'unsupported', message, contentType };
  return { kind: 'ignored', reason: 'service message (no text or media)' };
}

// ─── Sending ─────────────────────────────────────────────────────────────────

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  parameters?: { retry_after?: number };
}

/** Call a Bot API method. Retries once on rate limits (429), 5xx and network errors. */
export async function callTelegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const url = `${TELEGRAM_API_URL}/bot${getTelegramBotToken()}/${method}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
        REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      if (attempt === 2) {
        throw new TelegramApiError(`${method} failed: ${isTimeoutError(error) ? 'timed out' : describeError(error)}`);
      }
      await sleep(1000);
      continue;
    }

    const data = (await response.json().catch(() => ({ ok: false }))) as TelegramResponse<T>;
    if (response.ok && data.ok) return data.result as T;

    const retryAfterSeconds = data.parameters?.retry_after;
    const retryable = response.status === 429 || response.status >= 500;
    if (attempt === 1 && retryable && (retryAfterSeconds ?? 1) <= 10) {
      log.warn('TELEGRAM', `${method} returned ${response.status}, retrying`, { retryAfterSeconds });
      await sleep((retryAfterSeconds ?? 1) * 1000);
      continue;
    }
    throw new TelegramApiError(`${method} failed (${response.status}): ${data.description ?? 'unknown error'}`, response.status);
  }
  throw new TelegramApiError(`${method} failed`);
}

/** Split long text on paragraph (then line, then word) boundaries so each piece fits one message. */
export function splitMessage(text: string, limit = MAX_MESSAGE_CHARS): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const paragraph of text.split('\n\n')) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= limit) {
      current = candidate;
      continue;
    }
    pushCurrent();
    if (paragraph.length <= limit) {
      current = paragraph;
      continue;
    }
    // A single paragraph longer than the limit: fall back to splitting on spaces.
    for (const word of paragraph.split(' ')) {
      if ((current + ' ' + word).length > limit) pushCurrent();
      current = current ? `${current} ${word}` : word;
    }
  }
  pushCurrent();
  return chunks;
}

/**
 * Send a plain-text message (split into several if needed).
 * Returns the Telegram message IDs, so a draft can later be matched when
 * Meera replies to it.
 */
export async function sendMessage(chatId: number, text: string, options: { replyToMessageId?: number } = {}): Promise<number[]> {
  const messageIds: number[] = [];
  const chunks = splitMessage(text);
  for (const [index, chunk] of chunks.entries()) {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
      link_preview_options: { is_disabled: true },
    };
    if (index === 0 && options.replyToMessageId) {
      payload.reply_parameters = { message_id: options.replyToMessageId, allow_sending_without_reply: true };
    }
    const sent = await callTelegram<{ message_id: number }>('sendMessage', payload);
    messageIds.push(sent.message_id);
  }
  log.info('TELEGRAM', 'Message sent', { chatId, parts: chunks.length });
  return messageIds;
}

/** Send a message but never throw - for status/error replies where failure shouldn't stop anything. */
export async function sendMessageSafely(chatId: number, text: string, options: { replyToMessageId?: number } = {}): Promise<void> {
  try {
    await sendMessage(chatId, text, options);
  } catch (error) {
    log.error('TELEGRAM', 'Could not send message', error, { chatId });
  }
}

/**
 * Show "typing…" in the chat while the pipeline works. Telegram clears it
 * after ~5 seconds, so we repeat it until stop() is called. Best effort only.
 */
export function startTypingIndicator(chatId: number): () => void {
  let stopped = false;
  const send = () => {
    if (stopped) return;
    callTelegram('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {
      stopped = true; // e.g. not supported in this chat type - just stop trying
    });
  };
  send();
  const timer = setInterval(send, 4500);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

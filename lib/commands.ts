/**
 * Meera's commands: APPROVE, REJECT, /start, /help.
 *
 * APPROVE / REJECT only change a draft's status in the database. Approving
 * never publishes or schedules anything - Meera remains the publisher.
 *
 * Which draft? In order:
 *   "APPROVE 12"             → draft #12
 *   Telegram Reply on a draft → that draft
 *   plain "APPROVE"           → the most recent pending draft in this chat
 */
import { isDatabaseConfigured } from './config';
import {
  countPendingDrafts,
  findDraftByDecisionMessage,
  findDraftByTelegramMessage,
  findLatestPendingDraft,
  getDraftById,
  recordDraftDecision,
} from './database';
import { log } from './logger';
import * as messages from './messages';
import { sendMessage, sendMessageSafely } from './telegram';
import type { DraftRow, IncomingMessage } from './types';

export type Command = { type: 'help' } | { type: 'approve' | 'reject'; draftId: number | null };

/**
 * Recognise a command. Deliberately strict: the whole message must be the
 * command, so a note like "Reject the new supplier's quote" is still a note.
 */
export function parseCommand(text: string): Command | null {
  const trimmed = text.trim();
  if (/^\/(start|help)(@\w+)?$/i.test(trimmed)) return { type: 'help' };
  const match = trimmed.match(/^\/?(approve|reject)(?:@\w+)?(?:\s+#?(\d+))?[\s.!]*$/i);
  if (!match) return null;
  return {
    type: match[1].toLowerCase() as 'approve' | 'reject',
    draftId: match[2] ? Number(match[2]) : null,
  };
}

async function findTargetDraft(message: IncomingMessage, draftId: number | null): Promise<DraftRow | null> {
  if (draftId !== null) return getDraftById(message.chatId, draftId);
  if (message.replyToMessageId !== null) {
    const replied = await findDraftByTelegramMessage(message.chatId, message.replyToMessageId);
    if (replied) return replied;
  }
  return findLatestPendingDraft(message.chatId);
}

export async function handleCommand(message: IncomingMessage, command: Command): Promise<void> {
  const chatId = message.chatId;

  if (command.type === 'help') {
    await sendMessageSafely(chatId, messages.help(chatId, isDatabaseConfigured()));
    return;
  }

  // Decisions are stored in Supabase; without it there is nothing to approve or reject.
  if (!isDatabaseConfigured()) {
    await sendMessageSafely(chatId, messages.approvalsNeedDatabase(), { replyToMessageId: message.messageId });
    return;
  }

  // Duplicate webhook delivery of the same APPROVE/REJECT: already applied, stay quiet.
  if (await findDraftByDecisionMessage(chatId, message.messageId)) {
    log.info('COMMAND', 'Duplicate decision message ignored', { chatId, messageId: message.messageId });
    return;
  }

  const draft = await findTargetDraft(message, command.draftId);
  if (!draft) {
    await sendMessageSafely(chatId, command.draftId !== null ? messages.draftNotFound(command.draftId) : messages.noPendingDraft(command.type));
    return;
  }
  if (draft.status !== 'pending') {
    await sendMessageSafely(chatId, messages.draftAlreadyDecided(draft));
    return;
  }

  const decision = command.type === 'approve' ? 'approved' : 'rejected';
  const updated = await recordDraftDecision(draft.id, decision, message.messageId);
  if (!updated) {
    // Someone (or a duplicate delivery) decided it a moment ago.
    if (await findDraftByDecisionMessage(chatId, message.messageId)) return;
    const current = await getDraftById(chatId, draft.id);
    await sendMessageSafely(chatId, messages.draftAlreadyDecided(current ?? draft));
    return;
  }

  log.info('COMMAND', `Draft ${decision}`, { draftId: updated.id, noteId: updated.note_id });
  const stillPending = await countPendingDrafts(chatId);

  if (decision === 'approved') {
    await sendMessageSafely(chatId, messages.approved(updated, stillPending), { replyToMessageId: message.messageId });
    // A clean copy of the post, ready to paste into LinkedIn by hand.
    await sendMessage(chatId, messages.approvedCopy(updated.draft_text)).catch((error) =>
      log.error('TELEGRAM', 'Could not send copy-ready text', error, { draftId: updated.id }),
    );
  } else {
    await sendMessageSafely(chatId, messages.rejected(updated, stillPending), { replyToMessageId: message.messageId });
  }
}

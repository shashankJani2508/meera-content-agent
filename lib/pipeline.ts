/**
 * The note pipeline:  score → (stop if < 6) → news angle → draft → save → send.
 *
 * Each step lives in lib/stages/. This file only decides the order, records
 * progress on the note, and makes sure any failure leaves the database in a
 * clear state (status "error") and Meera gets a simple message.
 *
 * The pipeline never publishes anything. It ends by sending a draft to
 * Telegram with status "pending"; only Meera's APPROVE / REJECT changes that.
 *
 * If Supabase isn't configured yet, the same steps run but nothing is saved,
 * and the messages to Meera say so.
 */
import { isDatabaseConfigured, NOTE_SCORE_THRESHOLD } from './config';
import * as database from './database';
import { AiOutputError, AiRequestError, VoiceProfileMissingError } from './errors';
import { describeError, log } from './logger';
import * as messages from './messages';
import { findNewsAngle } from './stages/findNewsAngle';
import { scoreNote } from './stages/scoreNote';
import { writeDraft, type DraftResult } from './stages/writeDraft';
import { sendMessage, sendMessageSafely, startTypingIndicator } from './telegram';
import type { DraftRow, NewsArticle, NoteRow, ScoreResult } from './types';
import { loadVoiceProfile } from './voice';

/** Where the pipeline records its results: Supabase, or nowhere if it isn't configured yet. */
interface NoteStore {
  saved: boolean;
  updateNote: typeof database.updateNote;
  insertDraft: typeof database.insertDraft;
  updateDraft: typeof database.updateDraft;
}

const supabaseStore: NoteStore = {
  saved: true,
  updateNote: (...args) => database.updateNote(...args),
  insertDraft: (...args) => database.insertDraft(...args),
  updateDraft: (...args) => database.updateDraft(...args),
};

const unsavedStore: NoteStore = {
  saved: false,
  updateNote: async () => {},
  updateDraft: async () => {},
  insertDraft: async (draft) => {
    const now = new Date().toISOString();
    return {
      ...draft,
      id: 0,
      status: 'pending',
      telegram_message_ids: null,
      decision_telegram_message_id: null,
      error_message: null,
      created_at: now,
      updated_at: now,
      approved_at: null,
      rejected_at: null,
    };
  },
};

export async function processNote(note: NoteRow): Promise<void> {
  const store = isDatabaseConfigured() ? supabaseStore : unsavedStore;
  const noteId = note.id;
  const chatId = note.telegram_chat_id;
  log.info('PIPELINE', 'Processing started', { noteId, saved: store.saved });
  const stopTyping = startTypingIndicator(chatId);

  try {
    // 1. Score the note.
    const score = await scoreNote(note.raw_text);
    const passed = score.score >= NOTE_SCORE_THRESHOLD;
    log.info('SCORING', passed ? 'Decision: develop' : 'Decision: reject', { noteId, score: score.score, threshold: NOTE_SCORE_THRESHOLD });
    await store.updateNote(noteId, {
      score: score.score,
      score_reason: score.reason,
      status: passed ? 'approved_for_drafting' : 'rejected',
    });

    if (!passed) {
      // The note stays in the database as "rejected". A failed send doesn't change that.
      await sendMessageSafely(chatId, messages.noteRejected(score.score, score.reason, store.saved), {
        replyToMessageId: note.telegram_message_id,
      });
      log.info('PIPELINE', 'Finished - note rejected, no draft', { noteId });
      return;
    }

    // 2. Load the voice profile before spending time on research.
    const voice = await loadVoiceProfile();

    // 3. Look for a genuinely relevant news angle (optional - never throws).
    const newsAngle = await findNewsAngle(note.raw_text);
    await store.updateNote(noteId, { search_keywords: newsAngle.keywords, search_query: newsAngle.searchQuery });

    // 4. Write the draft.
    const draft = await writeDraft({
      rawNote: note.raw_text,
      voice,
      news: newsAngle.article ? { article: newsAngle.article, relevanceReason: newsAngle.reason } : null,
    });
    const articleUsed = draft.newsUsed ? newsAngle.article : null;

    // 5. Save it as pending, then deliver it.
    const savedDraft = await store.insertDraft({
      note_id: noteId,
      telegram_chat_id: chatId,
      draft_text: draft.text,
      model_used: draft.modelUsed,
      voice_skill_version: voice.version,
      word_count: draft.wordCount,
      style_warnings: draft.styleWarnings,
      news_used: articleUsed !== null,
      news_headline: articleUsed?.headline ?? null,
      news_source: articleUsed?.source ?? null,
      news_date: articleUsed?.publishedAt ?? null,
      news_url: articleUsed?.url ?? null,
      news_relevance_reason: newsAngle.reason,
    });
    await deliverDraft(store, note, savedDraft, score, draft, articleUsed);
    // Meera already has the draft at this point, so a failure here is logged, not reported to her.
    await store.updateNote(noteId, { status: 'drafted' }).catch((error) =>
      log.error('DATABASE', 'Draft delivered but note status not updated to drafted', error, { noteId }),
    );
    log.info('PIPELINE', store.saved ? 'Finished - draft sent, waiting for APPROVE / REJECT' : 'Finished - draft sent (not saved: no database)', {
      noteId,
      draftId: savedDraft.id,
    });
  } catch (error) {
    await handleFailure(store, note, error);
  } finally {
    stopTyping();
  }
}

class DraftDeliveryError extends Error {}

async function deliverDraft(
  store: NoteStore,
  note: NoteRow,
  savedDraft: DraftRow,
  score: ScoreResult,
  draft: DraftResult,
  article: NewsArticle | null,
) {
  const text = messages.draftReady({
    draftId: savedDraft.id,
    draftText: draft.text,
    score: score.score,
    wordCount: draft.wordCount,
    modelLabel: draft.modelUsed,
    article,
    placeholders: draft.placeholders,
    styleWarnings: draft.styleWarnings,
    saved: store.saved,
  });

  try {
    const telegramMessageIds = await sendMessage(note.telegram_chat_id, text, { replyToMessageId: note.telegram_message_id });
    await store.updateDraft(savedDraft.id, { telegram_message_ids: telegramMessageIds });
  } catch (error) {
    // Meera hasn't seen this draft, so it must not sit as "pending" where a
    // bare APPROVE could approve it unseen.
    log.error('TELEGRAM', 'Draft delivery failed - marking draft as error', error, { draftId: savedDraft.id });
    await store.updateDraft(savedDraft.id, { status: 'error', error_message: `Telegram delivery failed: ${describeError(error)}` }).catch(() => {});
    throw new DraftDeliveryError('Draft could not be delivered');
  }
}

function userMessageFor(error: unknown, saved: boolean): string {
  if (error instanceof VoiceProfileMissingError) return messages.voiceProfileMissing(saved);
  if (error instanceof DraftDeliveryError) return messages.draftDeliveryFailed(saved);
  return messages.processingFailed(saved);
}

async function handleFailure(store: NoteStore, note: NoteRow, error: unknown): Promise<void> {
  const kind = error instanceof AiOutputError ? 'AI output invalid' : error instanceof AiRequestError ? 'AI request failed' : 'Pipeline error';
  log.error('PIPELINE', `${kind} - note marked as error`, error, { noteId: note.id });
  try {
    await store.updateNote(note.id, { status: 'error', error_message: describeError(error).slice(0, 500) });
  } catch (dbError) {
    log.error('DATABASE', 'Could not record the error status on the note', dbError, { noteId: note.id });
  }
  await sendMessageSafely(note.telegram_chat_id, userMessageFor(error, store.saved), { replyToMessageId: note.telegram_message_id });
}

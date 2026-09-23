/**
 * Every database read and write lives in this file. There are deliberately
 * no delete functions: rejected notes and drafts are kept as history.
 *
 * Failures are wrapped in DatabaseError and logged with the [DATABASE] prefix.
 */
import { DatabaseError } from './errors';
import { log } from './logger';
import { getSupabase } from './supabase';
import type { DraftRow, DraftStatus, NoteRow, NoteStatus, VoiceSkillRow } from './types';

/** Postgres error code for "unique constraint violated" - how we detect duplicates. */
const UNIQUE_VIOLATION = '23505';

function fail(action: string, error: { message: string; code?: string }): never {
  log.error('DATABASE', `${action} failed: ${error.message}`, undefined, { code: error.code });
  throw new DatabaseError(`${action} failed: ${error.message}`, error.code);
}

/**
 * Count-only queries (head: true) come back with no error even when the table
 * doesn't exist - just a missing count. Treat a missing count as a failure.
 */
function requireCount(action: string, count: number | null): number {
  if (count === null) fail(action, { message: 'no row count returned - does the table exist? (run database/schema.sql)', code: 'NO_COUNT' });
  return count;
}

// ─── Notes ───────────────────────────────────────────────────────────────────

export interface NewNote {
  telegram_chat_id: number;
  telegram_message_id: number;
  user_id: number | null;
  raw_text: string;
  telegram_sent_at: string;
}

/**
 * Save an incoming note. The (chat, message) pair is unique in the database,
 * so if Telegram delivers the same message twice the second insert fails
 * with a unique violation and we report it as a duplicate - no second note,
 * no second pipeline run. This is safe even if both arrive at the same moment.
 */
export async function insertNote(note: NewNote): Promise<{ duplicate: true } | { duplicate: false; note: NoteRow }> {
  const { data, error } = await getSupabase()
    .from('notes')
    .insert({ ...note, status: 'received' satisfies NoteStatus })
    .select()
    .single();
  if (error?.code === UNIQUE_VIOLATION) return { duplicate: true };
  if (error) fail('Saving note', error);
  log.info('DATABASE', 'Note saved', { noteId: data.id });
  return { duplicate: false, note: data as NoteRow };
}

export type NoteUpdate = Partial<Pick<NoteRow, 'score' | 'score_reason' | 'search_keywords' | 'search_query' | 'status' | 'error_message'>>;

export async function updateNote(noteId: number, fields: NoteUpdate): Promise<void> {
  const { error } = await getSupabase().from('notes').update(fields).eq('id', noteId);
  if (error) fail(`Updating note ${noteId}`, error);
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

export type NewDraft = Pick<
  DraftRow,
  | 'note_id'
  | 'telegram_chat_id'
  | 'draft_text'
  | 'model_used'
  | 'voice_skill_version'
  | 'word_count'
  | 'style_warnings'
  | 'news_used'
  | 'news_headline'
  | 'news_source'
  | 'news_date'
  | 'news_url'
  | 'news_relevance_reason'
>;

export async function insertDraft(draft: NewDraft): Promise<DraftRow> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .insert({ ...draft, status: 'pending' satisfies DraftStatus })
    .select()
    .single();
  if (error) fail(`Saving draft for note ${draft.note_id}`, error);
  log.info('DATABASE', 'Draft saved', { draftId: data.id, noteId: draft.note_id });
  return data as DraftRow;
}

export type DraftUpdate = Partial<Pick<DraftRow, 'status' | 'telegram_message_ids' | 'error_message'>>;

export async function updateDraft(draftId: number, fields: DraftUpdate): Promise<void> {
  const { error } = await getSupabase().from('drafts').update(fields).eq('id', draftId);
  if (error) fail(`Updating draft ${draftId}`, error);
}

export async function getDraftById(chatId: number, draftId: number): Promise<DraftRow | null> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .select()
    .eq('telegram_chat_id', chatId)
    .eq('id', draftId)
    .maybeSingle();
  if (error) fail(`Loading draft ${draftId}`, error);
  return (data as DraftRow | null) ?? null;
}

/** The draft whose Telegram message Meera replied to (Telegram's "Reply" feature). */
export async function findDraftByTelegramMessage(chatId: number, telegramMessageId: number): Promise<DraftRow | null> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .select()
    .eq('telegram_chat_id', chatId)
    .contains('telegram_message_ids', [telegramMessageId])
    .limit(1)
    .maybeSingle();
  if (error) fail('Finding draft by Telegram message', error);
  return (data as DraftRow | null) ?? null;
}

export async function findLatestPendingDraft(chatId: number): Promise<DraftRow | null> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .select()
    .eq('telegram_chat_id', chatId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) fail('Finding latest pending draft', error);
  return (data as DraftRow | null) ?? null;
}

export async function countPendingDrafts(chatId: number): Promise<number> {
  const { count, error } = await getSupabase()
    .from('drafts')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_chat_id', chatId)
    .eq('status', 'pending');
  if (error) fail('Counting pending drafts', error);
  return requireCount('Counting pending drafts', count);
}

/** Has this APPROVE/REJECT message already been applied? (duplicate webhook protection) */
export async function findDraftByDecisionMessage(chatId: number, telegramMessageId: number): Promise<DraftRow | null> {
  const { data, error } = await getSupabase()
    .from('drafts')
    .select()
    .eq('telegram_chat_id', chatId)
    .eq('decision_telegram_message_id', telegramMessageId)
    .limit(1)
    .maybeSingle();
  if (error) fail('Checking for an already-applied decision', error);
  return (data as DraftRow | null) ?? null;
}

/**
 * Mark a pending draft approved or rejected. Only updates the row if it is
 * still pending, so a decision is applied exactly once. Returns null if the
 * draft was no longer pending.
 */
export async function recordDraftDecision(
  draftId: number,
  decision: 'approved' | 'rejected',
  decisionMessageId: number,
): Promise<DraftRow | null> {
  const now = new Date().toISOString();
  const fields =
    decision === 'approved'
      ? { status: decision, approved_at: now, decision_telegram_message_id: decisionMessageId }
      : { status: decision, rejected_at: now, decision_telegram_message_id: decisionMessageId };
  const { data, error } = await getSupabase()
    .from('drafts')
    .update(fields)
    .eq('id', draftId)
    .eq('status', 'pending')
    .select()
    .maybeSingle();
  if (error) fail(`Recording ${decision} for draft ${draftId}`, error);
  return (data as DraftRow | null) ?? null;
}

// ─── Voice skill ─────────────────────────────────────────────────────────────

export async function getActiveVoiceProfile(): Promise<VoiceSkillRow | null> {
  const { data, error } = await getSupabase().from('voice_skill').select().eq('is_active', true).limit(1).maybeSingle();
  if (error) fail('Loading active voice profile', error);
  return (data as VoiceSkillRow | null) ?? null;
}

export async function countVoiceProfiles(): Promise<number> {
  const { count, error } = await getSupabase().from('voice_skill').select('id', { count: 'exact', head: true });
  if (error) fail('Counting voice profiles', error);
  return requireCount('Counting voice profiles', count);
}

/**
 * Store a new voice profile version and make it the active one, in a single
 * transaction (the publish_voice_skill function in schema.sql). Older
 * versions are kept, just marked inactive.
 */
export async function publishVoiceProfile(profileText: string, source: string): Promise<VoiceSkillRow> {
  const { data, error } = await getSupabase().rpc('publish_voice_skill', {
    new_profile_text: profileText,
    new_source: source,
  });
  if (error) fail('Publishing voice profile', error);
  const row = (Array.isArray(data) ? data[0] : data) as VoiceSkillRow;
  log.info('DATABASE', 'Voice profile published', { version: row.version, source });
  return row;
}

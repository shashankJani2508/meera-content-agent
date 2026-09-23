/**
 * In-memory stand-in for lib/database.ts with the same functions and the same
 * rules that matter (unique chat+message per note, one draft per note,
 * decisions only on pending drafts). Used with vi.mock('@/lib/database').
 */
import { DatabaseError } from '@/lib/errors';
import type { DraftRow, NoteRow, VoiceSkillRow } from '@/lib/types';
import type { DraftUpdate, NewDraft, NewNote, NoteUpdate } from '@/lib/database';

export const db = {
  notes: [] as NoteRow[],
  drafts: [] as DraftRow[],
  voice: [] as VoiceSkillRow[],
  /** Set to make every call throw, to simulate Supabase being down. */
  failing: false,
};

let clock = 0;
const now = () => new Date(Date.UTC(2026, 8, 23, 6, 0, clock++)).toISOString();

function guard() {
  if (db.failing) throw new DatabaseError('Supabase unavailable (simulated)');
}

export function resetDatabase() {
  db.notes = [];
  db.drafts = [];
  db.voice = [];
  db.failing = false;
  clock = 0;
}

export async function insertNote(note: NewNote) {
  guard();
  if (db.notes.some((n) => n.telegram_chat_id === note.telegram_chat_id && n.telegram_message_id === note.telegram_message_id)) {
    return { duplicate: true as const };
  }
  const row: NoteRow = {
    id: db.notes.length + 1,
    ...note,
    score: null,
    score_reason: null,
    search_keywords: null,
    search_query: null,
    status: 'received',
    error_message: null,
    created_at: now(),
    updated_at: now(),
  };
  db.notes.push(row);
  return { duplicate: false as const, note: { ...row } };
}

export async function updateNote(noteId: number, fields: NoteUpdate) {
  guard();
  const note = db.notes.find((n) => n.id === noteId);
  if (note) Object.assign(note, fields, { updated_at: now() });
}

export async function insertDraft(draft: NewDraft) {
  guard();
  if (db.drafts.some((d) => d.note_id === draft.note_id)) throw new DatabaseError('duplicate draft for note', '23505');
  const row: DraftRow = {
    id: db.drafts.length + 1,
    ...draft,
    status: 'pending',
    telegram_message_ids: null,
    decision_telegram_message_id: null,
    error_message: null,
    created_at: now(),
    updated_at: now(),
    approved_at: null,
    rejected_at: null,
  };
  db.drafts.push(row);
  return { ...row };
}

export async function updateDraft(draftId: number, fields: DraftUpdate) {
  guard();
  const draft = db.drafts.find((d) => d.id === draftId);
  if (draft) Object.assign(draft, fields, { updated_at: now() });
}

export async function getDraftById(chatId: number, draftId: number) {
  guard();
  return db.drafts.find((d) => d.telegram_chat_id === chatId && d.id === draftId) ?? null;
}

export async function findDraftByTelegramMessage(chatId: number, messageId: number) {
  guard();
  return db.drafts.find((d) => d.telegram_chat_id === chatId && d.telegram_message_ids?.includes(messageId)) ?? null;
}

export async function findLatestPendingDraft(chatId: number) {
  guard();
  return [...db.drafts].reverse().find((d) => d.telegram_chat_id === chatId && d.status === 'pending') ?? null;
}

export async function countPendingDrafts(chatId: number) {
  guard();
  return db.drafts.filter((d) => d.telegram_chat_id === chatId && d.status === 'pending').length;
}

export async function findDraftByDecisionMessage(chatId: number, messageId: number) {
  guard();
  return db.drafts.find((d) => d.telegram_chat_id === chatId && d.decision_telegram_message_id === messageId) ?? null;
}

export async function recordDraftDecision(draftId: number, decision: 'approved' | 'rejected', decisionMessageId: number) {
  guard();
  const draft = db.drafts.find((d) => d.id === draftId && d.status === 'pending');
  if (!draft) return null;
  draft.status = decision;
  draft.decision_telegram_message_id = decisionMessageId;
  if (decision === 'approved') draft.approved_at = now();
  else draft.rejected_at = now();
  return { ...draft };
}

export async function getActiveVoiceProfile() {
  guard();
  return db.voice.find((v) => v.is_active) ?? null;
}

export async function countVoiceProfiles() {
  guard();
  return db.voice.length;
}

export async function publishVoiceProfile(profileText: string, source: string) {
  guard();
  db.voice.forEach((v) => (v.is_active = false));
  const row: VoiceSkillRow = {
    id: db.voice.length + 1,
    profile_text: profileText,
    version: db.voice.length + 1,
    is_active: true,
    source,
    created_at: now(),
    updated_at: now(),
  };
  db.voice.push(row);
  return row;
}

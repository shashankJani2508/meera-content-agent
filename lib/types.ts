/**
 * Shapes shared across the app. The *Row types mirror the Supabase tables in
 * database/schema.sql - if you add a column there, add it here too.
 */

export type NoteStatus = 'received' | 'rejected' | 'approved_for_drafting' | 'drafted' | 'error';
export type DraftStatus = 'pending' | 'approved' | 'rejected' | 'error';

export interface NoteRow {
  id: number;
  telegram_chat_id: number;
  telegram_message_id: number;
  user_id: number | null;
  raw_text: string;
  score: number | null;
  score_reason: string | null;
  search_keywords: string[] | null;
  search_query: string | null;
  status: NoteStatus;
  error_message: string | null;
  telegram_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DraftRow {
  id: number;
  note_id: number;
  telegram_chat_id: number;
  draft_text: string;
  status: DraftStatus;
  model_used: string | null;
  voice_skill_version: number | null;
  word_count: number | null;
  style_warnings: string[] | null;
  news_used: boolean;
  news_headline: string | null;
  news_source: string | null;
  news_date: string | null;
  news_url: string | null;
  news_relevance_reason: string | null;
  telegram_message_ids: number[] | null;
  decision_telegram_message_id: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  rejected_at: string | null;
}

export interface VoiceSkillRow {
  id: number;
  profile_text: string;
  version: number;
  is_active: boolean;
  source: string | null;
  created_at: string;
  updated_at: string;
}

/** A Telegram message after we've checked and simplified the raw webhook payload. */
export interface IncomingMessage {
  updateId: number;
  chatId: number;
  /** Telegram user ID of the sender. Null for posts in a channel. */
  userId: number | null;
  messageId: number;
  text: string | null;
  sentAt: Date;
  /** Set when Meera uses Telegram's "Reply" on one of the bot's messages. */
  replyToMessageId: number | null;
  source: 'private_chat' | 'group' | 'channel';
}

/** One news result from Google News. */
export interface NewsArticle {
  headline: string;
  source: string;
  /** ISO timestamp. */
  publishedAt: string;
  url: string;
  /** Google News RSS gives very little text; often empty. */
  summary: string;
}

export interface ScoreResult {
  score: number;
  reason: string;
}

export interface KeywordResult {
  keywords: string[];
  searchQuery: string;
}

export interface RelevanceResult {
  relevant: boolean;
  /** 1-based index into the candidates, when relevant. */
  articleNumber: number | null;
  reason: string;
}

export interface VoiceProfile {
  text: string;
  version: number | null;
  source: 'database' | 'file';
}

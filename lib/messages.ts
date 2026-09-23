/**
 * Every message the bot sends to Meera, in one place, so the wording is easy
 * to review and change. Messages never include error details, stack traces
 * or anything from server logs.
 */
import type { DraftRow, NewsArticle } from './types';

const DIVIDER = '─────────────────────────────────';

/**
 * How every bot message begins. In a channel, a post starting like this is
 * treated as the bot's own message and never processed as a note - a safety
 * net against the bot reading its own draft and looping. (Telegram is
 * reported not to send bots their own channel posts; this guards in case.)
 * A test checks every message below starts with one of these.
 */
export const BOT_MESSAGE_PREFIXES = [
  'DRAFT READY',
  "This one isn't strong enough",
  'Approved and saved.',
  'Copy-ready text:',
  'Rejected and saved.',
  "There's no pending draft",
  "I couldn't find draft",
  'Draft #',
  'Send me a raw note',
  'I can only work with text notes',
  'This is a private bot.',
  "I couldn't save that note",
  "I couldn't update the draft",
  'Something went wrong while working',
  "I couldn't find your voice profile",
  'I wrote a draft for this note',
  'APPROVE and REJECT need the database',
];

export function looksLikeBotMessage(text: string): boolean {
  const trimmed = text.trimStart();
  return BOT_MESSAGE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function formatNewsDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(isoDate));
}

function draftLabel(draft: Pick<DraftRow, 'id' | 'draft_text'>): string {
  const opening = draft.draft_text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 8).join(' ');
  return `Draft #${draft.id} ("${opening}…")`;
}

/** Mandatory whenever a draft uses a news item. Meera must see the source before approving. */
export function newsVerificationBlock(article: Pick<NewsArticle, 'headline' | 'source' | 'publishedAt' | 'url'>): string {
  return [
    DIVIDER,
    `NEWS SOURCE: ${article.headline}`,
    `FROM: ${article.source} · ${formatNewsDate(article.publishedAt)}`,
    `LINK: ${article.url}`,
    '⚠ Check this before publishing — you are the author of this claim',
    DIVIDER,
  ].join('\n');
}

export interface DraftMessageInput {
  draftId: number;
  draftText: string;
  score: number;
  wordCount: number;
  modelLabel: string;
  article: NewsArticle | null;
  placeholders: string[];
  styleWarnings: string[];
  /** False while Supabase isn't connected: the draft isn't stored, so APPROVE/REJECT can't work. */
  saved?: boolean;
}

const NOT_SAVED_NOTE = "(The database isn't connected yet, so this wasn't saved.)";

export function draftReady(input: DraftMessageInput): string {
  const saved = input.saved ?? true;
  const header = saved ? `DRAFT READY · #${input.draftId}` : 'DRAFT READY (not saved)';
  const parts = [header, `Score ${input.score}/10 · ${input.wordCount} words · drafted by ${input.modelLabel}`, input.draftText];

  if (input.article) parts.push(newsVerificationBlock(input.article));

  if (input.placeholders.length > 0) {
    const count = input.placeholders.length;
    parts.push(`TO FILL IN: ${count} bracketed placeholder${count === 1 ? '' : 's'} marked [ ... ] - the draft needs your facts there.`);
  }
  if (input.styleWarnings.length > 0) {
    parts.push(`STYLE CHECK: ${input.styleWarnings.join('; ')}.`);
  }

  parts.push(
    saved
      ? ['Reply:', 'APPROVE → mark this draft approved', 'REJECT → mark this draft rejected', 'Nothing is published automatically.'].join('\n')
      : [
          "APPROVE / REJECT are off until the database is connected, so this draft isn't stored anywhere - copy it from here if you want it.",
          'Nothing is published automatically.',
        ].join('\n'),
  );
  return parts.join('\n\n');
}

export function noteRejected(score: number, reason: string, saved = true): string {
  return [
    "This one isn't strong enough to develop into a post yet.",
    `Score: ${score}/10\nReason: ${reason}`,
    saved ? "I've saved the note, but I haven't drafted it." : `I haven't drafted it. ${NOT_SAVED_NOTE}`,
  ].join('\n\n');
}

export function approved(draft: DraftRow, stillPending: number): string {
  const lines = [
    "Approved and saved. I haven't published it — you remain the final publisher.",
    draftLabel(draft),
  ];
  if (stillPending > 0) lines.push(`${stillPending} other draft${stillPending === 1 ? ' is' : 's are'} still waiting for a decision.`);
  return lines.join('\n\n');
}

/** Sent right after approval: the clean post text, ready to paste into LinkedIn. */
export function approvedCopy(draftText: string): string {
  return `Copy-ready text:\n\n${draftText}`;
}

export function rejected(draft: DraftRow, stillPending: number): string {
  const lines = ['Rejected and saved. The note and draft remain in the archive.', draftLabel(draft)];
  if (stillPending > 0) lines.push(`${stillPending} other draft${stillPending === 1 ? ' is' : 's are'} still waiting for a decision.`);
  return lines.join('\n\n');
}

export function noPendingDraft(action: 'approve' | 'reject'): string {
  return `There's no pending draft to ${action} right now.`;
}

export function draftNotFound(draftId: number): string {
  return `I couldn't find draft #${draftId} in this chat.`;
}

export function draftAlreadyDecided(draft: DraftRow): string {
  if (draft.status === 'error') {
    return `Draft #${draft.id} was never delivered properly, so it can't be approved or rejected. The note is still saved - send it again to get a new draft.`;
  }
  return `Draft #${draft.id} is already ${draft.status}. I haven't changed it.`;
}

export function help(chatId: number, databaseConnected = true): string {
  const lines = [
    'Send me a raw note - an observation, a reaction, a half-formed idea.',
    "I'll score it. If it's strong enough, I'll look for relevant current news and draft a LinkedIn post in your voice. Weak notes are saved but not drafted.",
    'When a draft arrives, reply APPROVE or REJECT. To pick a specific draft, use Telegram\'s Reply on it, or send e.g. "APPROVE 12".',
    'Nothing is ever published automatically. You publish.',
  ];
  if (!databaseConnected) {
    lines.push("Right now the database isn't connected, so nothing is saved and APPROVE / REJECT are off. Scoring, news and drafting work.");
  }
  lines.push(`This chat's ID: ${chatId}`);
  return lines.join('\n\n');
}

export function unsupportedMessage(): string {
  return 'I can only work with text notes for now - send this one as text and I\'ll take it from there.';
}

export function notAuthorised(chatId: number): string {
  return `This is a private bot. (Chat ID: ${chatId})`;
}

export function noteSaveFailed(): string {
  return "I couldn't save that note because the database isn't responding. Nothing is lost on your side - it's still in this chat. Please send it again in a few minutes.";
}

export function commandFailed(): string {
  return "I couldn't update the draft because the database isn't responding. Nothing has changed - please try again in a minute.";
}

export function processingFailed(saved = true): string {
  const storage = saved ? 'The note is saved.' : NOT_SAVED_NOTE;
  return `Something went wrong while working on this note, so I haven't drafted it. ${storage} Try sending it again in a few minutes.`;
}

export function voiceProfileMissing(saved = true): string {
  const storage = saved ? 'The note is saved and scored.' : NOT_SAVED_NOTE;
  return `I couldn't find your voice profile, so I haven't drafted this note (drafting without it would produce generic writing). ${storage}`;
}

export function draftDeliveryFailed(saved = true): string {
  if (!saved) return "I wrote a draft for this note but couldn't deliver it properly. Please send the note again.";
  return "I wrote a draft for this note but couldn't deliver it properly, so I've marked it as an error rather than leaving it waiting for approval. Please send the note again.";
}

/** APPROVE / REJECT sent while Supabase isn't connected. */
export function approvalsNeedDatabase(): string {
  return "APPROVE and REJECT need the database, which isn't connected yet - so nothing was recorded. Nothing is ever published automatically.";
}

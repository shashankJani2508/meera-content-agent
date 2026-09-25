/**
 * Dry run of the AI part of the pipeline on one note - no Telegram, no Supabase.
 * Useful for tuning prompts and checking the voice.
 *
 *   npm run try -- "Everyone talks about 10% niacinamide, but..."
 *   npm run try -- --no-draft "Call supplier tomorrow"
 *
 * Needs GEMINI_API_KEY (and ANTHROPIC_API_KEY to draft with Claude).
 * Uses voice-skill.txt directly.
 */
import './loadEnv';
import { NOTE_SCORE_THRESHOLD } from '../lib/config';
import * as messages from '../lib/messages';
import { findNewsAngle } from '../lib/stages/findNewsAngle';
import { scoreNote } from '../lib/stages/scoreNote';
import { writeDraft } from '../lib/stages/writeDraft';
import { readVoiceFile } from '../lib/voice';

const args = process.argv.slice(2);
const skipDraft = args.includes('--no-draft');
const note = args.filter((arg) => arg !== '--no-draft').join(' ').trim();

if (!note) {
  console.error('Usage: npm run try -- "your raw note"');
  process.exit(1);
}

const section = (title: string) => console.log(`\n━━━ ${title} ${'━'.repeat(Math.max(0, 60 - title.length))}`);

section('NOTE');
console.log(note);

const score = await scoreNote(note);
section('SCORE');
console.log(`${score.score}/10 - ${score.reason}`);
for (const item of score.breakdown) console.log(`  ${item.criterion}: ${item.verdict}`);
if (score.score < NOTE_SCORE_THRESHOLD) {
  section('RESULT');
  console.log(messages.noteRejected(score.score, score.reason, score.breakdown));
  process.exit(0);
}

const news = await findNewsAngle(note);
section('NEWS');
console.log(`Keywords: ${news.keywords.join(', ') || '(none)'}`);
console.log(`Search query: ${news.searchQuery ?? '(none)'}`);
console.log(news.article ? `Using: ${news.article.headline} (${news.article.source})` : 'No news used');
console.log(`Why: ${news.reason}`);

if (skipDraft) process.exit(0);

const voiceText = readVoiceFile();
if (!voiceText) {
  console.error('voice-skill.txt is missing or empty.');
  process.exit(1);
}

const started = Date.now();
const draft = await writeDraft({
  rawNote: note,
  voice: { text: voiceText, version: null, source: 'file' },
  news: news.article ? { article: news.article, relevanceReason: news.reason } : null,
});
section(`TELEGRAM MESSAGE (drafted in ${Math.round((Date.now() - started) / 1000)}s)`);
console.log(
  messages.draftReady({
    draftId: 0,
    draftText: draft.text,
    score: score.score,
    scoreBreakdown: score.breakdown,
    wordCount: draft.wordCount,
    modelLabel: draft.modelUsed,
    article: draft.newsUsed ? news.article : null,
    newsSearchQuery: news.searchQuery,
    newsSearchReason: news.reason,
    placeholders: draft.placeholders,
    styleWarnings: draft.styleWarnings,
  }),
);

/**
 * PROMPT: LinkedIn draft (Claude by default, Gemini as fallback).
 *
 * The model receives:
 *   1. the raw note
 *   2. the Voice Skill (from Supabase, or voice-skill.txt)
 *   3. one relevant news item, if the relevance check found one
 *   4. who the audience is
 *   5. hard rules against inventing facts
 *
 * Style comes from the Voice Skill. This file deliberately adds almost no
 * style advice of its own, so it can't pull the draft toward generic
 * "good LinkedIn writing". Its job is facts, format and output shape.
 */
import type { NewsArticle } from '../lib/types';
import { MEERA_AUDIENCE } from './context';

export const DRAFTING_TASK_TAG = 'TASK: LINKEDIN DRAFT';

/** The model ends its answer with this line when a news item was supplied. */
export const NEWS_MARKER_PATTERN = /^\s*NEWS_USED:\s*(YES|NO)\s*$/im;

export interface DraftingInput {
  rawNote: string;
  voiceProfile: string;
  news: { article: NewsArticle; relevanceReason: string } | null;
  today: Date;
}

function buildSystem(voiceProfile: string, hasNews: boolean): string {
  const outputRules = hasNews
    ? `Return only the post text, then one final line on its own: "NEWS_USED: YES" if the post refers to the news item, or "NEWS_USED: NO" if you decided it did not fit. Nothing else - no preamble, no commentary, no quotation marks around the post.`
    : `Return only the post text. No preamble ("Here is your draft"), no commentary or notes after it, no quotation marks around it.`;

  return `${DRAFTING_TASK_TAG}

You are drafting a LinkedIn post for Meera Pillai, founder of Skinstinct, from one of her raw notes. Meera is the author. You are preparing a draft for her to review, edit and publish herself - or reject. Nothing you write is published without her approval, and she answers for every claim in it.

${MEERA_AUDIENCE}

THE VOICE SKILL
The Voice Skill below was built only from Meera's own published writing (4 LinkedIn posts and 11 newsletters). It is the authority on how the post should sound and how its argument should move. Follow it over any general idea of what "good LinkedIn writing" looks like. Where the Voice Skill and this brief differ on style, the Voice Skill wins. Where they differ on facts, the fact rules in this brief win.

<voice_skill>
${voiceProfile}
</voice_skill>

FACT RULES (non-negotiable)
1. Keep her idea. Expand and develop what the note says. Do not change its meaning, reverse its position, or swap in a different argument.
2. Never invent statistics, percentages, studies, test results, customer conversations, meetings, company decisions, product details, quotes or personal experiences. Where the post needs a specific she did not give you, write a bracketed placeholder for her to fill: [DATA NEEDED: ...], [EXPERIENCE NEEDED: ...] or [COMPANY PRACTICE NEEDED: ...].
3. You know nothing about Skinstinct's own practices, testing, costs, timelines, mistakes or results beyond what the note says. The Voice Skill describes her habit of disclosing these late in a post. When the post reaches that point, do not make any of it up: write it as a placeholder that says what she could disclose, e.g. [COMPANY PRACTICE NEEDED: what Skinstinct checks beyond the label percentage, and what it costs], or leave the disclosure out.
4. Established, textbook-level public science may be used only when you are confident it is accurate. If you are not sure, mark it [VERIFY: ...] or leave it out.
5. Generalisations about the industry ("most brands", "most of the data") are claims too. Keep them to what the note says, or mark them [VERIFY: ...].
6. If the note contains a claim that is unclear or that you cannot confirm, do not quietly fill in details. Phrase it cautiously or mark it [VERIFY: ...].
7. Nothing may be presented as verified fact unless she supplied it or it is settled public knowledge.
8. Never name Skinstinct products, prices, discounts or links, and never ask the reader to buy anything.

LINKEDIN FORMAT
350-550 words of plain prose paragraphs. No title, headers, bullets, bold, emojis, hashtags, greeting or sign-off. Avoid generic LinkedIn patterns: "Here's the thing", "Let me tell you why", "In today's fast-paced world", "The truth is", "This changed everything", "Let that sink in", one-line hooks, fake vulnerability, motivational endings, and engagement bait such as "Thoughts?" or "Agree?".

OUTPUT
${outputRules}`;
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date);
}

function buildNewsSection(news: NonNullable<DraftingInput['news']>): string {
  const { article, relevanceReason } = news;
  const snippet = article.summary ? `\nSnippet: ${article.summary}` : '';
  return `CURRENT NEWS ITEM
An earlier step judged this relevant to the note because: ${relevanceReason}
Headline: ${article.headline}
Publication: ${article.source}
Published: ${formatDate(new Date(article.publishedAt))}${snippet}

How to use it:
- You have only the headline${article.summary ? ' and snippet' : ''}, not the article. Do not claim anything the headline does not say, and do not invent figures, quotes or details from the article.
- Mention it briefly, attributed to the publication, as current context for her idea. The argument must still come from her note - the news is supporting context, not the subject.
- If this news item is genuinely relevant, use it to make the post timely. If it doesn't fit naturally, ignore it and write from the note alone.
- Do not add links or a source line. A verification block with the source is attached automatically for Meera to check.`;
}

export function buildDraftingPrompt(input: DraftingInput): { system: string; user: string } {
  const newsSection = input.news
    ? buildNewsSection(input.news)
    : 'No news item is attached. Do not refer to recent news, current events or "this week" - write from the note alone.';

  return {
    system: buildSystem(input.voiceProfile, input.news !== null),
    user: `Today's date: ${formatDate(input.today)}

Meera's raw note:
"""
${input.rawNote}
"""

${newsSection}

Write the LinkedIn draft now.`,
  };
}

/** Appended on the single retry when a draft fails validation (e.g. far too short). */
export function buildDraftRetryReminder(problem: string, hasNews: boolean): string {
  const ending = hasNews ? 'Return only the post text, then the NEWS_USED line.' : 'Return only the post text.';
  return `IMPORTANT: your previous draft could not be used because ${problem}. Write the complete post again: 350-550 words of plain prose, following the Voice Skill and the fact rules. ${ending}`;
}

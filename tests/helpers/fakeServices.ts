/**
 * Replaces global fetch() with a fake that answers like Gemini, Google News
 * and the Telegram Bot API, and records every call - so tests run offline and
 * can assert exactly what the pipeline asked for and sent.
 */
import { vi } from 'vitest';
import { DRAFTING_TASK_TAG } from '@/prompts/drafting';
import { KEYWORDS_TASK_TAG } from '@/prompts/keywordExtraction';
import { RELEVANCE_TASK_TAG } from '@/prompts/newsRelevance';
import { SCORING_TASK_TAG } from '@/prompts/scoring';
import { handleTelegramUpdate } from '@/lib/webhookHandler';

export type GeminiTask = 'scoring' | 'keywords' | 'relevance' | 'drafting';
/** A model answer (text) or an HTTP failure. */
export type GeminiReply = string | { status: number };

export interface FakeConfig {
  /** Answers per task, used in order; the last one repeats. */
  gemini: Partial<Record<GeminiTask, GeminiReply[]>>;
  /** `xmlForQuery` overrides `xml` when set, so a test can answer differently per search term (e.g. the compound query vs. a single broadening keyword). */
  news?: { status?: number; xml?: string; xmlForQuery?: (query: string) => string };
  /** Make Telegram sendMessage fail with this HTTP status. */
  telegramSendFailure?: number;
}

export const calls = {
  gemini: [] as Array<{ task: GeminiTask; user: string; system: string }>,
  news: [] as string[],
  telegram: [] as Array<{ method: string; payload: Record<string, any> }>,
};

/** Text of every sendMessage call, in order. */
export const sentTexts = () => calls.telegram.filter((c) => c.method === 'sendMessage').map((c) => String(c.payload.text));

function taskFor(system: string): GeminiTask {
  if (system.includes(SCORING_TASK_TAG)) return 'scoring';
  if (system.includes(KEYWORDS_TASK_TAG)) return 'keywords';
  if (system.includes(RELEVANCE_TASK_TAG)) return 'relevance';
  if (system.includes(DRAFTING_TASK_TAG)) return 'drafting';
  throw new Error('Unknown Gemini prompt in test');
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function installFakeServices(config: FakeConfig) {
  calls.gemini = [];
  calls.news = [];
  calls.telegram = [];
  const counters: Partial<Record<GeminiTask, number>> = {};
  let telegramMessageId = 5000;

  vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(String(init?.body));
      const system: string = body.systemInstruction.parts[0].text;
      const user: string = body.contents[0].parts[0].text;
      const task = taskFor(system);
      calls.gemini.push({ task, user, system });
      const replies = config.gemini[task];
      if (!replies?.length) throw new Error(`Test did not configure a Gemini reply for "${task}"`);
      const index = counters[task] ?? 0;
      counters[task] = index + 1;
      const reply = replies[Math.min(index, replies.length - 1)];
      if (typeof reply !== 'string') return json({ error: { message: 'simulated failure' } }, reply.status);
      return json({ candidates: [{ content: { parts: [{ text: reply }] }, finishReason: 'STOP' }] });
    }

    if (url.includes('news.google.com')) {
      calls.news.push(url);
      const news = config.news ?? { xml: rssFeed([]) };
      if (news.status && news.status !== 200) return new Response('unavailable', { status: news.status });
      const query = new URL(url).searchParams.get('q') ?? '';
      const xml = news.xmlForQuery ? news.xmlForQuery(query) : (news.xml ?? rssFeed([]));
      return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
    }

    if (url.includes('api.telegram.org')) {
      const method = url.split('/').pop() ?? '';
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      calls.telegram.push({ method, payload });
      if (method === 'sendMessage' && config.telegramSendFailure) {
        return json({ ok: false, description: 'Bad Request: simulated' }, config.telegramSendFailure);
      }
      return json({ ok: true, result: method === 'sendMessage' ? { message_id: ++telegramMessageId } : true });
    }

    throw new Error(`Unexpected network call in test: ${url}`);
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

export function rssFeed(items: Array<{ title: string; source: string; daysAgo: number; link?: string }>): string {
  const itemXml = items
    .map((item, i) => {
      const date = new Date(Date.now() - item.daysAgo * 24 * 60 * 60 * 1000).toUTCString();
      return `<item>
  <title>${item.title} - ${item.source}</title>
  <link>${item.link ?? `https://news.google.com/rss/articles/test-${i}`}</link>
  <pubDate>${date}</pubDate>
  <description>&lt;a href="https://example.com/${i}"&gt;${item.title}&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;${item.source}&lt;/font&gt;</description>
  <source url="https://example.com">${item.source}</source>
</item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Google News</title>${itemXml}</channel></rss>`;
}

const PARAGRAPH =
  'The number on the front of the bottle is the part everyone reads first, and it is also the part that tells you the least about whether the formulation will do anything once it is on your skin. A concentration is an input. What happens next depends on the pH of the base, on whether the active stays stable across its shelf life, and on whether the vehicle actually delivers it where it needs to go. None of that is printed on the label, and most brands are not asked about it.';

/** A plausible ~370-word draft that passes validation. */
export const SAMPLE_DRAFT = [PARAGRAPH, PARAGRAPH, PARAGRAPH, PARAGRAPH].join('\n\n');

export const TELEGRAM_CHAT_ID = 111222333;

let nextMessageId = 100;

export function telegramTextUpdate(text: string, options: { messageId?: number; replyTo?: number } = {}) {
  const messageId = options.messageId ?? nextMessageId++;
  return {
    update_id: 900000 + messageId,
    message: {
      message_id: messageId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: TELEGRAM_CHAT_ID, type: 'private' },
      from: { id: TELEGRAM_CHAT_ID, is_bot: false, first_name: 'Meera' },
      text,
      ...(options.replyTo ? { reply_to_message: { message_id: options.replyTo } } : {}),
    },
  };
}

/** Deliver an update the way the route does, then wait for the background pipeline to finish. */
export async function deliver(update: unknown): Promise<void> {
  const background: Promise<void>[] = [];
  await handleTelegramUpdate(update, (task) => background.push(task()));
  await Promise.all(background);
}

export const STRONG_NOTE =
  "Everyone talks about 10% niacinamide, but the percentage on the label isn't enough to tell you whether the formulation will actually perform.";
export const WEAK_NOTE = 'Call supplier tomorrow.';

// The score is always computed as the sum of the breakdown's marks (see
// lib/validation.ts) - there is no separate "score" field to fake. These two
// match the scoring prompt's own worked examples exactly, so the fixture and
// the prompt can never silently drift apart.
export const replies = {
  // idea 4 + specificity 2 + fit 2 = 8
  strongScore:
    '{"reason": "A specific gap between a label number and real performance, squarely in her formulation expertise.", "breakdown": [' +
    '{"criterion": "idea", "marks": 4, "verdict": "Sharp label-vs-performance gap"}, ' +
    '{"criterion": "specificity", "marks": 2, "verdict": "Names the exact ingredient and number"}, ' +
    '{"criterion": "fit", "marks": 2, "verdict": "Right in her formulation expertise"}]}',
  // idea 0 + specificity 0 + fit 0 = 0
  weakScore:
    '{"reason": "A to-do reminder with no idea to develop.", "breakdown": [' +
    '{"criterion": "idea", "marks": 0, "verdict": "No idea, just a logistics task"}, ' +
    '{"criterion": "specificity", "marks": 0, "verdict": "Nothing to anchor a post to"}, ' +
    '{"criterion": "fit", "marks": 0, "verdict": "Not a content topic at all"}]}',
  keywords: '{"keywords": ["niacinamide", "label claims", "formulation"], "search_query": "niacinamide label claims"}',
  notRelevant: '{"relevant": false, "article_number": null, "reason": "Same industry, but not about the note\'s point."}',
  relevantFirst: '{"relevant": true, "article_number": 1, "reason": "Directly about how label percentages mislead buyers."}',
};

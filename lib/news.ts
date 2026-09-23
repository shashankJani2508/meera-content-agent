/**
 * News search via the public Google News RSS feed - no account, no API key.
 *
 * Returns recent articles (last 30 days) for a short query. Note that the
 * RSS feed only carries headline, publication, date and link - there is no
 * real article summary, which is why the drafting prompt is told it only
 * has the headline and must not claim more than that.
 */
import { XMLParser } from 'fast-xml-parser';
import { NewsSearchError } from './errors';
import { fetchWithTimeout, isTimeoutError } from './http';
import type { NewsArticle } from './types';

const GOOGLE_NEWS_RSS_URL = 'https://news.google.com/rss/search';
const REQUEST_TIMEOUT_MS = 10_000;
export const MAX_ARTICLE_AGE_DAYS = 30;
const RESULTS_PER_EDITION = 5;
export const MAX_CANDIDATES = 8;

// Meera's business and audience are in India, but the most useful news for a
// point about formulation or claims is often international - so search both.
const EDITIONS = [
  { hl: 'en-IN', gl: 'IN', ceid: 'IN:en' },
  { hl: 'en-US', gl: 'US', ceid: 'US:en' },
];

async function searchEdition(query: string, edition: Record<string, string>, now: Date): Promise<NewsArticle[]> {
  const url = new URL(GOOGLE_NEWS_RSS_URL);
  url.searchParams.set('q', `${query} when:${MAX_ARTICLE_AGE_DAYS}d`);
  for (const [key, value] of Object.entries(edition)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeeraContentAgent/1.0)', Accept: 'application/rss+xml, application/xml' } },
      REQUEST_TIMEOUT_MS,
    );
  } catch (error) {
    throw new NewsSearchError(isTimeoutError(error) ? 'Google News timed out' : 'Could not reach Google News');
  }
  if (!response.ok) throw new NewsSearchError(`Google News returned HTTP ${response.status}`);
  return parseGoogleNewsRss(await response.text(), now).slice(0, RESULTS_PER_EDITION);
}

/** Recent articles for `query` from both editions, de-duplicated, newest first. Throws only if every edition fails. */
export async function searchGoogleNews(query: string, now = new Date()): Promise<NewsArticle[]> {
  const results = await Promise.allSettled(EDITIONS.map((edition) => searchEdition(query, edition, now)));
  const succeeded = results.filter((r): r is PromiseFulfilledResult<NewsArticle[]> => r.status === 'fulfilled');
  if (succeeded.length === 0) throw (results[0] as PromiseRejectedResult).reason;

  const seen = new Set<string>();
  return succeeded
    .flatMap((r) => r.value)
    .filter((article) => {
      const key = article.headline.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, MAX_CANDIDATES);
}

const HTML_ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&lt;': '<', '&gt;': '>' };

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&amp;|&quot;|&#39;|&apos;|&lt;|&gt;/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

function asText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (value && typeof value === 'object' && '#text' in value) return String((value as { '#text': unknown })['#text']).trim();
  return '';
}

/** Parse the RSS XML into clean, recent, de-duplicated articles (newest first). */
export function parseGoogleNewsRss(xml: string, now = new Date()): NewsArticle[] {
  let document: unknown;
  try {
    document = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
  } catch {
    throw new NewsSearchError('Google News returned unreadable XML');
  }

  const channel = (document as { rss?: { channel?: { item?: unknown } } })?.rss?.channel;
  if (!channel) throw new NewsSearchError('Google News response was not an RSS feed');
  const rawItems = channel.item === undefined ? [] : Array.isArray(channel.item) ? channel.item : [channel.item];

  const oldestAllowed = now.getTime() - MAX_ARTICLE_AGE_DAYS * 24 * 60 * 60 * 1000;
  const seenHeadlines = new Set<string>();
  const articles: NewsArticle[] = [];

  for (const item of rawItems as Array<Record<string, unknown>>) {
    const source = asText(item.source);
    let headline = asText(item.title);
    // Google News titles look like "Headline - Publication"; drop the suffix.
    if (source && headline.endsWith(` - ${source}`)) headline = headline.slice(0, -(source.length + 3)).trim();
    const url = asText(item.link);
    const published = new Date(asText(item.pubDate));

    if (!headline || !url || !source || Number.isNaN(published.getTime())) continue;
    if (published.getTime() < oldestAllowed || published.getTime() > now.getTime() + 24 * 60 * 60 * 1000) continue;
    const key = headline.toLowerCase();
    if (seenHeadlines.has(key)) continue;
    seenHeadlines.add(key);

    // The RSS "description" is usually just the headline and publication again.
    let summary = htmlToText(asText(item.description));
    if (summary.toLowerCase().startsWith(key)) summary = '';

    articles.push({ headline, source, publishedAt: published.toISOString(), url, summary });
  }

  return articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

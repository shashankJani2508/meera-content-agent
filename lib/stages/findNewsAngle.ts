/**
 * STAGES 2-4 together: keywords → Google News search → relevance check.
 *
 * News is optional, so this never throws. If any step fails (bad AI output,
 * Google News down, nothing relevant) the draft is simply written without a
 * news angle - the post is never forced to be "timely".
 */
import { describeError, log } from '../logger';
import { MAX_CANDIDATES, searchGoogleNews } from '../news';
import type { NewsArticle } from '../types';
import { checkNewsRelevance } from './checkNewsRelevance';
import { extractKeywords } from './extractKeywords';

export interface NewsAngle {
  keywords: string[];
  searchQuery: string | null;
  article: NewsArticle | null;
  /** Why the article was used - or why no article was used. */
  reason: string;
}

/**
 * Runs every query in parallel and merges the results (de-duplicated by
 * headline, newest first, capped). Any query that fails is silently dropped
 * - only if all of them fail does this throw.
 */
async function searchMultiple(queries: string[]): Promise<NewsArticle[]> {
  const results = await Promise.allSettled(queries.map((query) => searchGoogleNews(query)));
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

/**
 * The AI's chosen search phrase is often 3-4 words and genuinely specific -
 * useful for precision, but Google News frequently has zero results for it.
 * A single short keyword casts a much wider net and reliably surfaces
 * candidates the compound phrase misses entirely. Both are searched, always
 * (not only when the first search comes back empty), so the relevance step
 * gets the richer pool to judge from on every note - it still has to find
 * something genuinely on-topic; this only gives it more to look through.
 */
function buildQueries(searchQuery: string, keywords: string[]): string[] {
  const broadQuery = keywords[0];
  if (!broadQuery || broadQuery.toLowerCase() === searchQuery.toLowerCase()) return [searchQuery];
  return [searchQuery, broadQuery];
}

export async function findNewsAngle(rawNote: string): Promise<NewsAngle> {
  let keywords: string[] = [];
  let searchQuery: string | null = null;

  try {
    const extracted = await extractKeywords(rawNote);
    keywords = extracted.keywords;
    searchQuery = extracted.searchQuery;
  } catch (error) {
    log.warn('KEYWORDS', 'Keyword extraction failed - drafting without news', { error: describeError(error) });
    return { keywords, searchQuery, article: null, reason: 'Keyword extraction failed' };
  }

  let candidates: NewsArticle[];
  try {
    const queries = buildQueries(searchQuery, keywords);
    candidates = await searchMultiple(queries);
    log.info('NEWS', 'News search finished', {
      queries,
      results: candidates.length,
      headlines: candidates.map((a) => a.headline),
    });
  } catch (error) {
    log.warn('NEWS', 'News search failed - drafting without news', { error: describeError(error) });
    return { keywords, searchQuery, article: null, reason: 'News search failed' };
  }

  try {
    const decision = await checkNewsRelevance(rawNote, candidates);
    return { keywords, searchQuery, article: decision.article, reason: decision.reason };
  } catch (error) {
    log.warn('RELEVANCE', 'Relevance check failed - drafting without news', { error: describeError(error) });
    return { keywords, searchQuery, article: null, reason: 'Relevance check failed' };
  }
}

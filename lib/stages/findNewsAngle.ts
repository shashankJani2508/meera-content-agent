/**
 * STAGES 2-4 together: keywords → Google News search → relevance check.
 *
 * News is optional, so this never throws. If any step fails (bad AI output,
 * Google News down, nothing relevant) the draft is simply written without a
 * news angle - the post is never forced to be "timely".
 */
import { describeError, log } from '../logger';
import { searchGoogleNews } from '../news';
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
    candidates = await searchGoogleNews(searchQuery);
    // A very specific query can return nothing; try once more with the two main concepts.
    const broaderQuery = keywords.slice(0, 2).join(' ');
    if (candidates.length === 0 && keywords.length >= 2 && broaderQuery.toLowerCase() !== searchQuery.toLowerCase()) {
      log.info('NEWS', 'No results - retrying with a broader query', { broaderQuery });
      candidates = await searchGoogleNews(broaderQuery);
    }
    log.info('NEWS', 'News search finished', {
      searchQuery,
      results: candidates.length,
      topHeadline: candidates[0]?.headline,
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

/**
 * STAGE 4 - Does any news candidate genuinely add useful current context to
 * the note? Returns the chosen article, or null. Choosing none is normal.
 */
import { generateJson } from '../gemini';
import { log } from '../logger';
import type { NewsArticle, RelevanceResult } from '../types';
import { validateRelevanceResult } from '../validation';
import { buildRelevancePrompt, RELEVANCE_JSON_SHAPE } from '../../prompts/newsRelevance';

export interface RelevanceDecision {
  article: NewsArticle | null;
  reason: string;
}

export async function checkNewsRelevance(rawNote: string, candidates: NewsArticle[]): Promise<RelevanceDecision> {
  if (candidates.length === 0) return { article: null, reason: 'No recent news found' };

  const result: RelevanceResult = await generateJson({
    stage: 'RELEVANCE',
    ...buildRelevancePrompt(rawNote, candidates),
    jsonShape: RELEVANCE_JSON_SHAPE,
    validate: (value) => validateRelevanceResult(value, candidates.length),
  });

  const article = result.relevant && result.articleNumber ? candidates[result.articleNumber - 1] : null;
  log.info('RELEVANCE', article ? 'News item accepted' : 'No news item used', {
    headline: article?.headline,
    reason: result.reason,
    candidates: candidates.length,
  });
  return { article, reason: result.reason };
}

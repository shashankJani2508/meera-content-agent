/** STAGE 2 - Turn the note into 3-5 search concepts and one short news query. */
import { generateJson } from '../gemini';
import { log } from '../logger';
import type { KeywordResult } from '../types';
import { validateKeywordResult } from '../validation';
import { buildKeywordPrompt, KEYWORDS_JSON_SHAPE } from '../../prompts/keywordExtraction';

export async function extractKeywords(rawNote: string): Promise<KeywordResult> {
  const result = await generateJson({
    stage: 'KEYWORDS',
    ...buildKeywordPrompt(rawNote),
    jsonShape: KEYWORDS_JSON_SHAPE,
    validate: validateKeywordResult,
  });
  if (result.keywords.length < 3) {
    log.warn('KEYWORDS', 'Fewer than 3 keywords returned', { count: result.keywords.length });
  }
  log.info('KEYWORDS', 'Search terms extracted', { keywords: result.keywords, searchQuery: result.searchQuery });
  return result;
}

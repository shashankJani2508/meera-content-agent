/** STAGE 1 - Score the raw note 0-10. Throws if the model can't produce a valid score. */
import { generateJson } from '../gemini';
import { log, preview } from '../logger';
import type { ScoreResult } from '../types';
import { validateScoreResult } from '../validation';
import { buildScoringPrompt, SCORING_JSON_SHAPE } from '../../prompts/scoring';

export async function scoreNote(rawNote: string): Promise<ScoreResult> {
  const prompt = buildScoringPrompt(rawNote);
  const result = await generateJson({
    stage: 'SCORING',
    ...prompt,
    jsonShape: SCORING_JSON_SHAPE,
    validate: validateScoreResult,
  });
  log.info('SCORING', 'Note scored', { score: result.score, reason: result.reason, breakdown: result.breakdown.length, note: preview(rawNote) });
  if (result.breakdown.length === 0) {
    log.warn('SCORING', 'Model returned no usable score breakdown - Telegram message will show the score and reason only');
  }
  return result;
}

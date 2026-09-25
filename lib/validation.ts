/**
 * Never trust AI output blindly. Every structured answer from a model goes
 * through one of these validators before the pipeline uses it. A validator
 * either returns a clean value or a short description of what was wrong
 * (which is fed back to the model on the one retry).
 */
import type { KeywordResult, RelevanceResult, ScoreBreakdownItem, ScoreResult } from './types';
import { SCORE_CRITERIA } from '../prompts/scoring';

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const valid = <T>(value: T): Validated<T> => ({ ok: true, value });
const invalid = <T>(error: string): Validated<T> => ({ ok: false, error });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 1)}…` : trimmed;
}

/**
 * Parse JSON the way models actually return it: sometimes wrapped in ```json
 * fences, sometimes with a sentence before or after the object.
 */
export function parseModelJson(text: string): Validated<unknown> {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    return valid(JSON.parse(withoutFences));
  } catch {
    const start = withoutFences.indexOf('{');
    const end = withoutFences.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return valid(JSON.parse(withoutFences.slice(start, end + 1)));
      } catch {
        // fall through
      }
    }
    return invalid('response was not valid JSON');
  }
}

/**
 * The breakdown explains the score but never gates it: a missing or malformed
 * breakdown just means the Telegram message shows the score and reason alone,
 * not a wasted retry over a decorative field.
 */
function parseScoreBreakdown(value: unknown): ScoreBreakdownItem[] {
  if (!Array.isArray(value)) return [];
  const byCriterion = new Map<string, string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) continue;
    const criterion = typeof entry.criterion === 'string' ? entry.criterion.trim().toLowerCase() : null;
    const verdict = cleanString(entry.verdict, 80);
    if (criterion && verdict && SCORE_CRITERIA.includes(criterion as (typeof SCORE_CRITERIA)[number])) {
      byCriterion.set(criterion, verdict);
    }
  }
  // Keep the fixed order (idea, specificity, fit) regardless of what order the model returned them in.
  return SCORE_CRITERIA.filter((criterion) => byCriterion.has(criterion)).map((criterion) => ({
    criterion,
    verdict: byCriterion.get(criterion)!,
  }));
}

export function validateScoreResult(value: unknown): Validated<ScoreResult> {
  if (!isPlainObject(value)) return invalid('expected a JSON object');
  const { score } = value;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 10) {
    return invalid('"score" must be a whole number from 0 to 10');
  }
  const reason = cleanString(value.reason, 300);
  if (!reason) return invalid('"reason" must be a non-empty string');
  return valid({ score, reason, breakdown: parseScoreBreakdown(value.breakdown) });
}

export function validateKeywordResult(value: unknown): Validated<KeywordResult> {
  if (!isPlainObject(value)) return invalid('expected a JSON object');
  if (!Array.isArray(value.keywords)) return invalid('"keywords" must be an array of strings');
  const keywords = [
    ...new Set(
      value.keywords
        .map((keyword) => cleanString(keyword, 60))
        .filter((keyword): keyword is string => keyword !== null),
    ),
  ].slice(0, 5);
  if (keywords.length === 0) return invalid('"keywords" must contain at least one non-empty string');
  const searchQuery = cleanString(value.search_query, 120)?.replace(/["“”]/g, '');
  if (!searchQuery) return invalid('"search_query" must be a non-empty string');
  return valid({ keywords, searchQuery });
}

export function validateRelevanceResult(value: unknown, candidateCount: number): Validated<RelevanceResult> {
  if (!isPlainObject(value)) return invalid('expected a JSON object');
  if (typeof value.relevant !== 'boolean') return invalid('"relevant" must be true or false');
  const reason = cleanString(value.reason, 300);
  if (!reason) return invalid('"reason" must be a non-empty string');
  if (!value.relevant) return valid({ relevant: false, articleNumber: null, reason });

  const articleNumber = value.article_number;
  if (
    typeof articleNumber !== 'number' ||
    !Number.isInteger(articleNumber) ||
    articleNumber < 1 ||
    articleNumber > candidateCount
  ) {
    return invalid(`"article_number" must be a whole number from 1 to ${candidateCount} when "relevant" is true`);
  }
  return valid({ relevant: true, articleNumber, reason });
}

export const DRAFT_MIN_WORDS = 150;
export const DRAFT_MAX_WORDS = 900;

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Checks a draft is a usable post (not empty, not truncated, not an essay),
 * and strips wrapping the model sometimes adds (code fences, surrounding quotes).
 */
export function validateDraftText(raw: string): Validated<string> {
  let text = raw.trim();
  text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  if (!text) return invalid('the draft was empty');
  const words = countWords(text);
  if (words < DRAFT_MIN_WORDS) return invalid(`the draft was only ${words} words (aim for 350-550)`);
  if (words > DRAFT_MAX_WORDS) return invalid(`the draft was ${words} words (aim for 350-550)`);
  return valid(text);
}

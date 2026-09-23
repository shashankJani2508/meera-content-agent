/**
 * STAGE 5 - Write the LinkedIn draft in Meera's voice.
 *
 * Claude drafts by default (it holds a voice better across a full post).
 * If Claude fails - outage, rate limit, refusal - the same prompt goes to
 * Gemini, and the draft records which model wrote it. Each model's answer is
 * validated, with one stricter retry, before it is accepted.
 */
import { generateTextWithClaude } from '../claude';
import { getAiConfig } from '../config';
import { AiOutputError } from '../errors';
import { callGemini } from '../gemini';
import { log } from '../logger';
import { applyMechanicalFixes, checkDraftStyle, findPlaceholders } from '../styleCheck';
import type { NewsArticle, VoiceProfile } from '../types';
import { countWords, validateDraftText } from '../validation';
import { buildDraftingPrompt, buildDraftRetryReminder, NEWS_MARKER_PATTERN } from '../../prompts/drafting';

export interface DraftInput {
  rawNote: string;
  voice: VoiceProfile;
  news: { article: NewsArticle; relevanceReason: string } | null;
}

export interface DraftResult {
  text: string;
  wordCount: number;
  modelUsed: string;
  /** True only if a news item was supplied AND the model says it used it. */
  newsUsed: boolean;
  styleWarnings: string[];
  placeholders: string[];
}

type TextGenerator = (system: string, user: string) => Promise<string>;

const generateWithGemini: TextGenerator = (system, user) => callGemini({ system, user, json: false });

/** Split off the model's "NEWS_USED: YES/NO" line. If it's missing, assume the news was used so the source is still shown. */
export function separateNewsMarker(raw: string, newsSupplied: boolean): { text: string; newsUsed: boolean } {
  const match = raw.match(NEWS_MARKER_PATTERN);
  const text = raw.replace(NEWS_MARKER_PATTERN, '').trim();
  if (!newsSupplied) return { text, newsUsed: false };
  return { text, newsUsed: match ? match[1].toUpperCase() === 'YES' : true };
}

async function draftWith(generate: TextGenerator, system: string, user: string, newsSupplied: boolean) {
  const firstRaw = await generate(system, user);
  const first = separateNewsMarker(firstRaw, newsSupplied);
  const firstCheck = validateDraftText(first.text);
  if (firstCheck.ok) return { text: firstCheck.value, newsUsed: first.newsUsed };

  log.warn('DRAFTING', 'Draft failed validation - retrying once', { problem: firstCheck.error });
  const secondRaw = await generate(system, `${user}\n\n${buildDraftRetryReminder(firstCheck.error, newsSupplied)}`);
  const second = separateNewsMarker(secondRaw, newsSupplied);
  const secondCheck = validateDraftText(second.text);
  if (secondCheck.ok) return { text: secondCheck.value, newsUsed: second.newsUsed };

  throw new AiOutputError(`Draft invalid twice (${secondCheck.error})`);
}

export async function writeDraft(input: DraftInput): Promise<DraftResult> {
  const config = getAiConfig();
  const { system, user } = buildDraftingPrompt({
    rawNote: input.rawNote,
    voiceProfile: input.voice.text,
    news: input.news,
    today: new Date(),
  });
  const newsSupplied = input.news !== null;

  let draft: { text: string; newsUsed: boolean };
  let modelUsed: string;

  if (config.draftingProvider === 'claude') {
    try {
      draft = await draftWith(generateTextWithClaude, system, user, newsSupplied);
      modelUsed = config.claudeModel;
    } catch (error) {
      log.error('DRAFTING', 'Claude drafting failed - falling back to Gemini', error);
      draft = await draftWith(generateWithGemini, system, user, newsSupplied);
      modelUsed = `${config.geminiModel} (fallback)`;
    }
  } else {
    draft = await draftWith(generateWithGemini, system, user, newsSupplied);
    modelUsed = config.geminiModel;
  }

  const text = applyMechanicalFixes(draft.text);
  const result: DraftResult = {
    text,
    wordCount: countWords(text),
    modelUsed,
    newsUsed: draft.newsUsed,
    styleWarnings: checkDraftStyle(text),
    placeholders: findPlaceholders(text),
  };
  log.info('DRAFTING', 'Draft created', {
    model: modelUsed,
    words: result.wordCount,
    newsUsed: result.newsUsed,
    placeholders: result.placeholders.length,
    styleWarnings: result.styleWarnings,
    voiceVersion: input.voice.version,
    voiceSource: input.voice.source,
  });
  return result;
}


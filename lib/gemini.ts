/**
 * Gemini client (Google AI Studio REST API).
 *
 * Used for the fast, cheap, mechanical steps: scoring, keyword extraction and
 * news relevance - and as the drafting fallback when Claude isn't available.
 *
 * callGemini()   one request, with retries for timeouts / rate limits / 5xx.
 * generateJson() asks for JSON, validates it, retries once with a stricter
 *                prompt if it's malformed, and throws AiOutputError if it's
 *                still unusable - so bad JSON never reaches the pipeline.
 */
import { getAiConfig } from './config';
import { AiOutputError, AiRequestError } from './errors';
import { fetchWithTimeout, isTimeoutError, retryDelayMs, sleep } from './http';
import { describeError, log, type LogStage } from './logger';
import { parseModelJson, type Validated } from './validation';
import { buildStrictJsonReminder } from '../prompts/jsonRetry';

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
// Short JSON answers normally take 2-5s; a full draft 15-40s.
const JSON_TIMEOUT_MS = 30_000;
const TEXT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

export interface GeminiRequest {
  system: string;
  user: string;
  /** Ask Gemini to answer in JSON mode. */
  json: boolean;
}

interface GeminiResponseBody {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

function extractText(body: GeminiResponseBody): string {
  const parts = body.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((part) => typeof part.text === 'string' && !part.thought)
    .map((part) => part.text)
    .join('')
    .trim();
}

export async function callGemini(request: GeminiRequest): Promise<string> {
  const { geminiApiKey, geminiModel } = getAiConfig();
  const url = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(geminiModel)}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: request.user }] }],
    generationConfig: request.json ? { responseMimeType: 'application/json' } : {},
  });

  const timeoutMs = request.json ? JSON_TIMEOUT_MS : TEXT_TIMEOUT_MS;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey }, body },
        timeoutMs,
      );
    } catch (error) {
      // Network failure or timeout - worth retrying.
      const reason = isTimeoutError(error) ? `timed out after ${timeoutMs / 1000}s` : describeError(error);
      if (attempt === MAX_ATTEMPTS) throw new AiRequestError(`Gemini request failed: ${reason}`, undefined, true);
      log.warn('AI', `Gemini request failed, retrying`, { attempt, reason });
      await sleep(retryDelayMs(attempt));
      continue;
    }

    if (response.ok) {
      const data = (await response.json()) as GeminiResponseBody;
      const text = extractText(data);
      if (!text) {
        const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'no text returned';
        throw new AiRequestError(`Gemini returned no text (${why})`);
      }
      return text;
    }

    // 429 (rate limit) and 5xx are temporary; 400/401/403/404 are not.
    const retryable = response.status === 429 || response.status >= 500;
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    if (!retryable || attempt === MAX_ATTEMPTS) {
      const hint = [400, 401, 403, 404].includes(response.status) ? ' - check GEMINI_API_KEY and GEMINI_MODEL' : '';
      throw new AiRequestError(`Gemini API error ${response.status}${hint}: ${detail}`, response.status, retryable);
    }
    log.warn('AI', `Gemini API returned ${response.status}, retrying`, { attempt });
    await sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
  }
  // Unreachable, but keeps TypeScript happy.
  throw new AiRequestError('Gemini request failed');
}

export interface JsonTask<T> {
  stage: LogStage;
  system: string;
  user: string;
  /** Example of the expected shape, shown to the model on the strict retry. */
  jsonShape: string;
  validate: (value: unknown) => Validated<T>;
}

function parseAndValidate<T>(text: string, validate: (value: unknown) => Validated<T>): Validated<T> {
  const parsed = parseModelJson(text);
  return parsed.ok ? validate(parsed.value) : parsed;
}

export async function generateJson<T>(task: JsonTask<T>): Promise<T> {
  const firstAnswer = await callGemini({ system: task.system, user: task.user, json: true });
  const first = parseAndValidate(firstAnswer, task.validate);
  if (first.ok) return first.value;

  log.warn(task.stage, 'Model output failed validation - retrying once with a stricter prompt', {
    problem: first.error,
  });
  const stricterUser = `${task.user}\n\n${buildStrictJsonReminder(first.error, task.jsonShape)}`;
  const secondAnswer = await callGemini({ system: task.system, user: stricterUser, json: true });
  const second = parseAndValidate(secondAnswer, task.validate);
  if (second.ok) return second.value;

  throw new AiOutputError(`${task.stage}: model output invalid twice (${second.error})`);
}

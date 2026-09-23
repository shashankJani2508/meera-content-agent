/**
 * Claude client (Anthropic SDK) - used for drafting, because it holds a
 * writer's voice better across a full post.
 *
 * The SDK already retries rate limits, 5xx errors and dropped connections
 * (maxRetries). We stream the response because drafts can take a while, and
 * collect the finished message with finalMessage().
 */
import Anthropic from '@anthropic-ai/sdk';
import { getAiConfig } from './config';
import { AiOutputError, AiRequestError } from './errors';

// Budget: the webhook function may run for 300s in total. Two Claude attempts
// (110s each at most) still leave time for the earlier steps and a Gemini fallback.
const REQUEST_TIMEOUT_MS = 110_000;

let client: Anthropic | null = null;

function getClient(apiKey: string): Anthropic {
  client ??= new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
  return client;
}

/** Turn SDK errors into our own error type with a useful, secret-free message. */
function toAiRequestError(error: unknown): AiRequestError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiRequestError('Claude rejected the API key - check ANTHROPIC_API_KEY', 401);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiRequestError('Claude rate limit reached', 429, true);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiRequestError('Claude request timed out', undefined, true);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new AiRequestError('Could not reach the Claude API', undefined, true);
  }
  if (error instanceof Anthropic.APIError) {
    return new AiRequestError(`Claude API error ${error.status ?? ''}: ${error.message}`, error.status);
  }
  return new AiRequestError(`Claude request failed: ${error instanceof Error ? error.message : String(error)}`);
}

export async function generateTextWithClaude(system: string, user: string): Promise<string> {
  const { anthropicApiKey, claudeModel } = getAiConfig();
  if (!anthropicApiKey) throw new AiRequestError('ANTHROPIC_API_KEY is not set');

  // On claude-opus-5, opt into server-side fallbacks: if a safety classifier
  // declines the request, the API retries it on Anthropic's recommended model
  // inside the same call instead of returning a refusal.
  const useServerFallback = claudeModel === 'claude-opus-5';

  let message: Anthropic.Beta.BetaMessage;
  try {
    const stream = getClient(anthropicApiKey).beta.messages.stream({
      model: claudeModel,
      max_tokens: 16000,
      output_config: { effort: 'high' },
      system,
      messages: [{ role: 'user', content: user }],
      ...(useServerFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    });
    message = await stream.finalMessage();
  } catch (error) {
    throw toAiRequestError(error);
  }

  if (message.stop_reason === 'refusal') {
    throw new AiOutputError('Claude declined to write this draft');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new AiOutputError('Claude ran out of output tokens before finishing the draft');
  }

  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) throw new AiOutputError('Claude returned no text');
  return text;
}

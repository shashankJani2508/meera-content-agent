/**
 * Logging with clear stage prefixes, e.g. "[SCORING] Note scored {...}".
 *
 * Every log line passes through redact(), which removes the values of our
 * secret environment variables and anything that looks like a Telegram bot
 * token or an API key in a URL - so a secret can't leak into Vercel logs
 * even if an error message happens to contain one.
 */

export type LogStage =
  | 'WEBHOOK'
  | 'PIPELINE'
  | 'SCORING'
  | 'KEYWORDS'
  | 'NEWS'
  | 'RELEVANCE'
  | 'DRAFTING'
  | 'VOICE'
  | 'DATABASE'
  | 'TELEGRAM'
  | 'COMMAND'
  | 'AI'
  | 'CONFIG';

const SECRET_ENV_NAMES = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_WEBHOOK_SECRET',
  'GEMINI_API_KEY',
  'ANTHROPIC_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

export function redact(text: string): string {
  let result = text;
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (value && value.length >= 8) {
      result = result.split(value).join(`[REDACTED ${name}]`);
    }
  }
  return (
    result
      // Telegram bot tokens: 123456789:AAH... (they appear inside api.telegram.org URLs)
      .replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, '[REDACTED TOKEN]')
      // Keys passed as query parameters
      .replace(/([?&](?:key|api_key|apikey|token)=)[^&\s"']+/gi, '$1[REDACTED]')
      // Anthropic keys and Supabase secret keys, wherever they appear
      .replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, '[REDACTED KEY]')
      .replace(/sb_secret_[A-Za-z0-9_-]{10,}/g, '[REDACTED KEY]')
  );
}

function formatDetails(details?: Record<string, unknown>): string {
  if (!details || Object.keys(details).length === 0) return '';
  try {
    return ' ' + JSON.stringify(details);
  } catch {
    return ' [details could not be serialised]';
  }
}

/** Short, secret-free description of any thrown value. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    const statusPart = typeof status === 'number' ? ` (status ${status})` : '';
    return redact(`${error.name}: ${error.message}${statusPart}`);
  }
  return redact(String(error));
}

const UNEXPECTED_ERROR_NAMES = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError']);

export const log = {
  info(stage: LogStage, message: string, details?: Record<string, unknown>): void {
    console.log(redact(`[${stage}] ${message}${formatDetails(details)}`));
  },
  warn(stage: LogStage, message: string, details?: Record<string, unknown>): void {
    console.warn(redact(`[${stage}] ${message}${formatDetails(details)}`));
  },
  error(stage: LogStage, message: string, error?: unknown, details?: Record<string, unknown>): void {
    const errorPart = error === undefined ? '' : ` - ${describeError(error)}`;
    console.error(redact(`[${stage}] ${message}${errorPart}${formatDetails(details)}`));
    // Stack traces only for unexpected crashes (plain Error, TypeError...), not for our own
    // named errors like ConfigError or AiRequestError, whose message already says it all.
    // They stay in server logs (never sent to Telegram) and are redacted too.
    if (error instanceof Error && error.stack && UNEXPECTED_ERROR_NAMES.has(error.name) && process.env.NODE_ENV !== 'test') {
      console.error(redact(error.stack));
    }
  },
};

/** Log-friendly preview of a note, so logs show which note without dumping all of it. */
export function preview(text: string, maxLength = 80): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength)}…` : singleLine;
}

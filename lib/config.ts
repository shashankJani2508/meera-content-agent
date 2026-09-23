/**
 * Configuration: reads environment variables and checks the required ones exist.
 *
 * Each part of the app asks only for the settings it needs (AI, Telegram,
 * Supabase), so a script that only needs Gemini doesn't fail because the
 * Telegram token is missing. Error messages name the missing variable but
 * never print any secret values.
 */

/** Notes scoring below this are saved but not drafted. */
export const NOTE_SCORE_THRESHOLD = 6;

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

export type DraftingProvider = 'claude' | 'gemini';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new ConfigError(
      `Missing environment variable ${name}. Add it to .env (local) or Vercel → Settings → Environment Variables. See README "Environment variables".`,
    );
  }
  return value;
}

/** Which model family writes drafts. Scoring and research always use Gemini. */
export function getDraftingProvider(): DraftingProvider {
  const explicit = readEnv('DRAFTING_PROVIDER')?.toLowerCase();
  if (explicit === 'claude' || explicit === 'gemini') return explicit;
  if (explicit) {
    throw new ConfigError(`DRAFTING_PROVIDER must be "claude" or "gemini" (or empty for automatic).`);
  }
  return readEnv('ANTHROPIC_API_KEY') ? 'claude' : 'gemini';
}

export interface AiConfig {
  geminiApiKey: string;
  geminiModel: string;
  anthropicApiKey: string | undefined;
  claudeModel: string;
  draftingProvider: DraftingProvider;
}

export function getAiConfig(): AiConfig {
  const draftingProvider = getDraftingProvider();
  const anthropicApiKey = readEnv('ANTHROPIC_API_KEY');
  if (draftingProvider === 'claude' && !anthropicApiKey) {
    throw new ConfigError('DRAFTING_PROVIDER is "claude" but ANTHROPIC_API_KEY is missing.');
  }
  return {
    geminiApiKey: requireEnv('GEMINI_API_KEY'),
    geminiModel: readEnv('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL,
    anthropicApiKey,
    claudeModel: readEnv('CLAUDE_MODEL') ?? DEFAULT_CLAUDE_MODEL,
    draftingProvider,
  };
}

export interface TelegramConfig {
  botToken: string;
  webhookSecret: string;
  /** Empty set means "allow every chat" (setup mode). */
  allowedChatIds: Set<string>;
}

export function getTelegramConfig(): TelegramConfig {
  const allowed = (readEnv('TELEGRAM_ALLOWED_CHAT_IDS') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
    webhookSecret: requireEnv('TELEGRAM_WEBHOOK_SECRET'),
    allowedChatIds: new Set(allowed),
  };
}

/** Just the bot token - for scripts that call Telegram but never receive webhooks. */
export function getTelegramBotToken(): string {
  return requireEnv('TELEGRAM_BOT_TOKEN');
}

export interface SupabaseConfig {
  url: string;
  serviceRoleKey: string;
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}

/**
 * Is Supabase set up? Without it the bot still scores, researches and drafts,
 * but nothing is saved and APPROVE / REJECT are switched off (see README,
 * "Running before the database is connected").
 */
export function isDatabaseConfigured(): boolean {
  return Boolean(readEnv('SUPABASE_URL') && readEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

/** Names (never values) of variables the bot cannot run without. Used by /api/health. */
export function getMissingEnvVars(): string[] {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'GEMINI_API_KEY'];
  if (readEnv('DRAFTING_PROVIDER')?.toLowerCase() === 'claude') required.push('ANTHROPIC_API_KEY');
  return required.filter((name) => !readEnv(name));
}

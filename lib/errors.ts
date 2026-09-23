/**
 * Named error types, so the pipeline can tell Meera something sensible
 * ("the voice profile is missing") instead of a generic failure, and so logs
 * say which kind of thing went wrong.
 */

/** An AI API call failed (network, timeout, rate limit, server error, bad key). */
export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AiRequestError';
  }
}

/** The AI answered, but the answer was unusable even after one stricter retry. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiOutputError';
  }
}

/** No voice profile in Supabase and no usable voice-skill.txt. */
export class VoiceProfileMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceProfileMissingError';
  }
}

/** A Supabase read or write failed. */
export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/** The Telegram Bot API rejected a request or could not be reached. */
export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

/** Google News could not be reached or returned something unreadable. */
export class NewsSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NewsSearchError';
  }
}

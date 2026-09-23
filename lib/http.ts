/** Small helpers shared by the Gemini, Telegram and Google News clients. */

/** fetch() that gives up after `timeoutMs` instead of hanging the function. */
export function fetchWithTimeout(url: string | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

/**
 * How long to wait before retry number `attempt` (1-based).
 * Honours a Retry-After header (in seconds) when the server sends one, capped at `maxMs`.
 */
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null, maxMs = 10_000): number {
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return Math.min(retryAfterSeconds * 1000, maxMs);
  }
  return Math.min(1000 * 2 ** (attempt - 1), maxMs); // 1s, 2s, 4s...
}

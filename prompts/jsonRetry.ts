/**
 * PROMPT: the one stricter retry, used when a model's JSON answer fails validation.
 * Appended to the original user message so the model sees what went wrong.
 */
export function buildStrictJsonReminder(problem: string, jsonShape: string): string {
  return `IMPORTANT: your previous answer could not be used because ${problem}.
Reply again with a single JSON object and nothing else - no explanation, no markdown, no code fences.
It must match exactly: ${jsonShape}`;
}

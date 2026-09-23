/**
 * GET /api/health - a quick "is it set up?" check after deploying.
 * Lists the names of any missing environment variables (never their values).
 */
import { getDraftingProvider, getMissingEnvVars, isDatabaseConfigured, NOTE_SCORE_THRESHOLD } from '@/lib/config';

export const dynamic = 'force-dynamic';

export function GET(): Response {
  const missing = getMissingEnvVars();
  let draftingProvider: string;
  try {
    draftingProvider = getDraftingProvider();
  } catch {
    draftingProvider = 'invalid DRAFTING_PROVIDER value';
  }
  return Response.json(
    {
      ok: missing.length === 0,
      missingEnvVars: missing,
      database: isDatabaseConfigured()
        ? 'configured'
        : 'not configured - notes and drafts are not saved and APPROVE/REJECT is off (add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)',
      draftingProvider,
      scoreThreshold: NOTE_SCORE_THRESHOLD,
      autoPublishing: false,
    },
    { status: missing.length === 0 ? 200 : 500 },
  );
}

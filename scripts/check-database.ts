/**
 * Read-only check of the Supabase setup: can we connect with the secret key,
 * and do the three tables from database/schema.sql exist?
 *   npm run db:check
 */
import './loadEnv';
import { getSupabase } from '../lib/supabase';

// Every column the app reads or writes (must match database/schema.sql and lib/types.ts).
const TABLES: Record<string, string[]> = {
  notes: ['id', 'telegram_chat_id', 'telegram_message_id', 'user_id', 'raw_text', 'score', 'score_reason', 'search_keywords', 'search_query', 'status', 'error_message', 'telegram_sent_at', 'created_at', 'updated_at'],
  drafts: ['id', 'note_id', 'telegram_chat_id', 'draft_text', 'status', 'model_used', 'voice_skill_version', 'word_count', 'style_warnings', 'news_used', 'news_headline', 'news_source', 'news_date', 'news_url', 'news_relevance_reason', 'telegram_message_ids', 'decision_telegram_message_id', 'error_message', 'created_at', 'updated_at', 'approved_at', 'rejected_at'],
  voice_skill: ['id', 'profile_text', 'version', 'is_active', 'source', 'created_at', 'updated_at'],
};
let allGood = true;

let supabase: ReturnType<typeof getSupabase>;
try {
  supabase = getSupabase();
} catch (error) {
  console.log(`✗ ${(error as Error).message}`);
  process.exit(1);
}

for (const [table, columns] of Object.entries(TABLES)) {
  // A real read (not head: true) - count-only requests hide "table not found".
  const { count, error } = await supabase.from(table).select(columns.join(','), { count: 'exact' }).limit(1);
  if (error) {
    allGood = false;
    const hint =
      error.code === '42P01' || /does not exist|schema cache/i.test(error.message)
        ? ' → table missing: run database/schema.sql in the Supabase SQL Editor'
        : /Invalid API key|JWT|apikey/i.test(error.message)
          ? ' → the key was rejected: use the secret (sb_secret_…) or service_role key'
          : '';
    console.log(`✗ ${table}: ${error.message}${hint}`);
  } else {
    console.log(`✓ ${table}: all ${columns.length} columns present (${count ?? 0} rows)`);
  }
}

// The voice-profile function from schema.sql. Called as a GET, which Supabase
// runs in a read-only transaction: a missing function answers "not found"
// (PGRST202); an existing one fails with "read-only transaction" (25006)
// because it tries to write. Either way nothing is saved.
const { error: functionError } = await supabase.rpc(
  'publish_voice_skill',
  { new_profile_text: 'db:check', new_source: 'db:check' },
  { get: true },
);
if (functionError?.code === 'PGRST202') {
  allGood = false;
  console.log('✗ publish_voice_skill function: missing → run database/schema.sql in the Supabase SQL Editor');
} else if (functionError?.code === '25006') {
  console.log('✓ publish_voice_skill function: present');
} else {
  allGood = false;
  console.log(`? publish_voice_skill function: unexpected answer (${functionError?.message ?? 'no error'})`);
}

console.log(allGood ? '\nDatabase is ready.' : '\nDatabase is not ready yet - see the lines marked ✗.');
process.exit(allGood ? 0 : 1);

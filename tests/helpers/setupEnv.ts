/**
 * Fake credentials for tests. No test ever reaches a real service: every test
 * file replaces fetch() and the database module with in-memory fakes.
 */
process.env.TELEGRAM_BOT_TOKEN = '1234567890:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret-value';
process.env.TELEGRAM_ALLOWED_CHAT_IDS = '';
process.env.GEMINI_API_KEY = 'test-gemini-key-123456';
process.env.GEMINI_MODEL = 'gemini-test';
process.env.ANTHROPIC_API_KEY = '';
process.env.DRAFTING_PROVIDER = 'gemini';
process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-123456';

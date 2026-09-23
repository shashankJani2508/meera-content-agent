/**
 * The Supabase client. Server-side only: it uses the service-role (secret)
 * key, which bypasses Row Level Security. That key must never reach a browser.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './config';

const REQUEST_TIMEOUT_MS = 15_000;

let client: SupabaseClient | null = null;

/** fetch with a timeout, so a slow database can't hang the whole function. */
const fetchWithDeadline: typeof fetch = (input, init) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

export function getSupabase(): SupabaseClient {
  if (!client) {
    const { url, serviceRoleKey } = getSupabaseConfig();
    client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithDeadline },
    });
  }
  return client;
}

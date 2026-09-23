/**
 * Show what Telegram knows about the webhook - useful when messages aren't arriving.
 *   npm run webhook:info
 */
import './loadEnv';
import { callTelegram } from '../lib/telegram';

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

const info = await callTelegram<WebhookInfo>('getWebhookInfo', {});
console.log(`URL:              ${info.url || '(not set - run npm run webhook:set)'}`);
console.log(`Pending updates:  ${info.pending_update_count}`);
if (info.last_error_message) {
  console.log(`Last error:       ${info.last_error_message} (${new Date((info.last_error_date ?? 0) * 1000).toISOString()})`);
} else {
  console.log('Last error:       none');
}

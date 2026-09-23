/**
 * Tell Telegram where to deliver messages sent to the bot.
 *
 *   npm run webhook:set -- https://your-project.vercel.app
 *
 * Uses TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env. The secret
 * is registered with Telegram, which then includes it in every webhook
 * request so the app can reject anything that didn't come from Telegram.
 */
import './loadEnv';
import { getTelegramConfig } from '../lib/config';
import { callTelegram } from '../lib/telegram';

const baseUrl = process.argv[2]?.trim().replace(/\/+$/, '');
if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  console.error('Usage: npm run webhook:set -- https://your-project.vercel.app   (must be https)');
  process.exit(1);
}

const { webhookSecret } = getTelegramConfig();
const webhookUrl = `${baseUrl}/api/webhook`;

await callTelegram('setWebhook', {
  url: webhookUrl,
  secret_token: webhookSecret,
  allowed_updates: ['message', 'channel_post'],
});
console.log(`Webhook set: ${webhookUrl}`);

const info = await callTelegram<{ url: string; pending_update_count: number }>('getWebhookInfo', {});
console.log(`Telegram confirms: ${info.url} (pending updates: ${info.pending_update_count})`);
console.log('Now send /start to your bot in Telegram.');

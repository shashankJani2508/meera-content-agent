/**
 * Run the whole agent on this computer - no Vercel, no public URL.
 * Fetches new Telegram messages by polling and handles each one exactly the
 * way the webhook does (same code: lib/webhookHandler.ts).
 *
 *   npm run dev:poll        (stop with Ctrl+C)
 *
 * Telegram delivers messages EITHER by webhook OR by polling, never both, so
 * this only works while no webhook is set. It will not remove a webhook for you.
 */
import './loadEnv';
import { sleep } from '../lib/http';
import { callTelegram } from '../lib/telegram';
import { handleTelegramUpdate } from '../lib/webhookHandler';

const webhook = await callTelegram<{ url: string }>('getWebhookInfo', {});
if (webhook.url) {
  console.error(`A webhook is set (${webhook.url}), so Telegram won't hand out messages by polling.`);
  console.error('Either use the deployed app, or remove the webhook first (npm run webhook:info shows it).');
  process.exit(1);
}

let offset = 0;
console.log('Polling Telegram. Post a note in your channel / chat with the bot. Ctrl+C to stop.');

while (true) {
  let updates: Array<{ update_id: number }>;
  try {
    // Long poll for up to 10s (kept under the Telegram client's 15s request timeout).
    updates = await callTelegram('getUpdates', { offset, timeout: 10, allowed_updates: ['message', 'channel_post'] });
  } catch (error) {
    console.error(`getUpdates failed: ${(error as Error).message} - retrying in 3s`);
    await sleep(3000);
    continue;
  }

  for (const update of updates) {
    offset = update.update_id + 1; // acknowledges this update, so it isn't delivered again
    const background: Promise<void>[] = [];
    try {
      await handleTelegramUpdate(update, (task) => background.push(task()));
      await Promise.all(background);
    } catch (error) {
      console.error(`Update ${update.update_id} failed: ${(error as Error).message}`);
    }
  }
}

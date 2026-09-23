/**
 * Send a fake Telegram update to your LOCAL server (npm run dev), so you can
 * test the full flow - Supabase, scoring, drafting, replies - without a
 * public URL. The bot's replies arrive in your real Telegram chat.
 *
 *   npm run simulate -- "Everyone talks about 10% niacinamide, but..."
 *   npm run simulate -- APPROVE
 *
 * Uses the first ID in TELEGRAM_ALLOWED_CHAT_IDS as the chat (send /start to
 * the bot to find yours). The server must be running on http://localhost:3000.
 */
import './loadEnv';

const text = process.argv.slice(2).join(' ').trim();
const chatId = Number((process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '').split(',')[0]?.trim());
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const baseUrl = process.env.SIMULATE_URL ?? 'http://localhost:3000';

if (!text) {
  console.error('Usage: npm run simulate -- "your note or APPROVE / REJECT"');
  process.exit(1);
}
if (!Number.isInteger(chatId) || chatId === 0) {
  console.error('Set TELEGRAM_ALLOWED_CHAT_IDS in .env to your chat ID first (send /start to your bot to see it).');
  process.exit(1);
}
if (!secret) {
  console.error('Set TELEGRAM_WEBHOOK_SECRET in .env first.');
  process.exit(1);
}

// A unique message ID each run, like Telegram would assign.
const messageId = Math.floor(Date.now() / 1000);
const update = {
  update_id: messageId,
  message: {
    message_id: messageId,
    date: Math.floor(Date.now() / 1000),
    chat: { id: chatId, type: 'private' },
    from: { id: chatId, is_bot: false, first_name: 'Meera' },
    text,
  },
};

const response = await fetch(`${baseUrl}/api/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
  body: JSON.stringify(update),
});
console.log(`Webhook answered ${response.status}: ${await response.text()}`);
console.log('Watch the `npm run dev` terminal for [SCORING] / [NEWS] / [DRAFTING] logs, and your Telegram chat for the reply.');

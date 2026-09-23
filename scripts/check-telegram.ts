/**
 * Read-only check of the Telegram setup: is the token valid, what kind of
 * chat is each allowed chat ID, and can the bot post there?
 *   npm run telegram:check
 */
import './loadEnv';
import { callTelegram } from '../lib/telegram';

interface BotInfo {
  id: number;
  username: string;
}

const me = await callTelegram<BotInfo>('getMe', {});
console.log(`Bot: @${me.username} (id ${me.id}) - token OK`);

const chatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
if (chatIds.length === 0) console.log('TELEGRAM_ALLOWED_CHAT_IDS is empty - the bot will accept any chat.');

for (const chatId of chatIds) {
  try {
    const chat = await callTelegram<{ title?: string; type: string }>('getChat', { chat_id: chatId });
    const member = await callTelegram<{ status: string; can_post_messages?: boolean }>('getChatMember', { chat_id: chatId, user_id: me.id });
    console.log(`Chat ${chatId}: "${chat.title ?? '(private chat)'}" (${chat.type}) - bot is ${member.status}`);
    if (chat.type === 'channel' && (member.status !== 'administrator' || !member.can_post_messages)) {
      console.log('  ⚠ In a channel the bot must be an administrator with "Post messages" permission.');
    }
  } catch (error) {
    console.log(`Chat ${chatId}: could not read (${(error as Error).message}). Is the bot a member of this chat?`);
  }
}

const webhook = await callTelegram<{ url: string; pending_update_count: number; last_error_message?: string }>('getWebhookInfo', {});
console.log(`Webhook: ${webhook.url || '(not set)'} · pending updates: ${webhook.pending_update_count}${webhook.last_error_message ? ` · last error: ${webhook.last_error_message}` : ''}`);

/**
 * POST /api/webhook - Telegram delivers every message sent to the bot here.
 *
 * 1. Reject anything that doesn't carry our secret token (not from Telegram).
 * 2. Hand the update to handleTelegramUpdate (saves the note, handles commands).
 * 3. Reply 200 OK immediately. The slow part (scoring, research, drafting)
 *    runs afterwards via Next.js `after()`, so Telegram never times out and
 *    re-sends the message.
 */
import { timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { ConfigError, getTelegramConfig } from '@/lib/config';
import { log } from '@/lib/logger';
import { handleTelegramUpdate } from '@/lib/webhookHandler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Scoring + news + a Claude draft usually takes 20-60s. Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 300;

function hasValidSecret(request: Request, expectedSecret: string): boolean {
  const received = request.headers.get('x-telegram-bot-api-secret-token') ?? '';
  const a = Buffer.from(received);
  const b = Buffer.from(expectedSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  let webhookSecret: string;
  try {
    webhookSecret = getTelegramConfig().webhookSecret;
  } catch (error) {
    log.error('CONFIG', error instanceof ConfigError ? 'Server is not configured' : 'Configuration error', error);
    return new Response('Server not configured', { status: 500 });
  }

  if (!hasValidSecret(request, webhookSecret)) {
    log.warn('WEBHOOK', 'Rejected request without a valid Telegram secret token');
    return new Response('Unauthorized', { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    log.warn('WEBHOOK', 'Request body was not JSON - ignored');
    return Response.json({ ok: true });
  }

  try {
    await handleTelegramUpdate(body, (task) => after(task));
  } catch (error) {
    // Always answer 200 so Telegram doesn't keep re-sending an update that will never work.
    log.error('WEBHOOK', 'Unhandled error while handling update', error);
  }
  return Response.json({ ok: true });
}

export function GET(): Response {
  return Response.json({ ok: true, message: 'Telegram webhook endpoint. Telegram sends POST requests here.' });
}

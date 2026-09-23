/** The HTTP route: only Telegram (with the secret) gets in, and it always gets a fast 200. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const background: Promise<unknown>[] = [];
vi.mock('next/server', () => ({ after: (task: () => Promise<unknown>) => background.push(task()) }));
vi.mock('@/lib/database', () => import('./helpers/fakeDatabase'));

import { POST } from '@/app/api/webhook/route';
import { db, resetDatabase } from './helpers/fakeDatabase';
import { installFakeServices, replies, telegramTextUpdate } from './helpers/fakeServices';

function request(body: unknown, secret?: string) {
  return new Request('http://localhost/api/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  resetDatabase();
  background.length = 0;
  installFakeServices({ gemini: { scoring: [replies.weakScore] } });
});

describe('POST /api/webhook', () => {
  it('rejects requests without the secret token', async () => {
    const response = await POST(request(telegramTextUpdate('hi')));
    expect(response.status).toBe(401);
    expect(db.notes).toHaveLength(0);
  });

  it('rejects requests with the wrong secret token', async () => {
    const response = await POST(request(telegramTextUpdate('hi'), 'wrong-secret'));
    expect(response.status).toBe(401);
  });

  it('accepts Telegram requests, saves the note, and runs the pipeline after responding', async () => {
    const response = await POST(request(telegramTextUpdate('Call supplier tomorrow.'), process.env.TELEGRAM_WEBHOOK_SECRET));
    expect(response.status).toBe(200);
    expect(db.notes).toHaveLength(1);
    await Promise.all(background);
    expect(db.notes[0].status).toBe('rejected');
  });

  it('answers 200 (so Telegram stops retrying) for a body that is not JSON', async () => {
    const response = await POST(request('not json', process.env.TELEGRAM_WEBHOOK_SECRET));
    expect(response.status).toBe(200);
  });

  it('returns 500 with no details when the server is not configured', async () => {
    const saved = process.env.TELEGRAM_WEBHOOK_SECRET;
    process.env.TELEGRAM_WEBHOOK_SECRET = '';
    const response = await POST(request(telegramTextUpdate('hi'), 'anything'));
    process.env.TELEGRAM_WEBHOOK_SECRET = saved;
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Server not configured');
  });
});

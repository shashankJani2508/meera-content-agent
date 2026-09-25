/** Verification block, style checks, voice file and log redaction. */
import { describe, expect, it, vi } from 'vitest';
import * as messages from '@/lib/messages';
import { newsVerificationBlock } from '@/lib/messages';
import type { DraftRow } from '@/lib/types';
import { redact } from '@/lib/logger';
import { applyMechanicalFixes, checkDraftStyle, findPlaceholders, removePlaceholderParagraphs } from '@/lib/styleCheck';
import { readVoiceFile } from '@/lib/voice';
import { separateNewsMarker } from '@/lib/stages/writeDraft';
import { SAMPLE_DRAFT } from './helpers/fakeServices';

describe('news verification block', () => {
  it('matches the required format exactly', () => {
    const block = newsVerificationBlock({
      headline: 'Regulator questions percentage claims',
      source: 'Business Standard',
      publishedAt: '2026-09-18T10:00:00.000Z',
      url: 'https://example.com/story',
    });
    expect(block).toBe(
      [
        '─────────────────────────────────',
        'NEWS SOURCE: Regulator questions percentage claims',
        'FROM: Business Standard · 18 Sept 2026',
        'LINK: https://example.com/story',
        '⚠ Check this before publishing — you are the author of this claim',
        '─────────────────────────────────',
      ].join('\n'),
    );
  });
});

describe('loop guard prefixes', () => {
  it('cover every message the bot can send', () => {
    const draft = { id: 3, draft_text: 'The number on the front of the bottle', status: 'rejected' } as DraftRow;
    const allMessages = [
      messages.draftReady({
        draftId: 1,
        draftText: 'x',
        score: 8,
        scoreBreakdown: [],
        wordCount: 400,
        modelLabel: 'm',
        article: null,
        newsSearchQuery: null,
        newsSearchReason: null,
        placeholders: [],
        styleWarnings: [],
      }),
      messages.noteRejected(2, 'reason'),
      messages.approved(draft, 0),
      messages.approvedCopy({ draft_text: 'text', news_used: false, news_source: null, news_date: null, news_url: null }),
      messages.rejected(draft, 1),
      messages.noPendingDraft('approve'),
      messages.draftNotFound(9),
      messages.draftAlreadyDecided(draft),
      messages.draftAlreadyDecided({ ...draft, status: 'error' }),
      messages.help(123),
      messages.unsupportedMessage(),
      messages.notAuthorised(123),
      messages.noteSaveFailed(),
      messages.commandFailed(),
      messages.processingFailed(),
      messages.voiceProfileMissing(),
      messages.draftDeliveryFailed(),
      messages.draftDeliveryFailed(false),
      messages.draftReady({
        draftId: 0,
        draftText: 'x',
        score: 8,
        scoreBreakdown: [],
        wordCount: 400,
        modelLabel: 'm',
        article: null,
        newsSearchQuery: null,
        newsSearchReason: null,
        placeholders: [],
        styleWarnings: [],
        saved: false,
      }),
      messages.noteRejected(2, 'reason', [], false),
      messages.processingFailed(false),
      messages.voiceProfileMissing(false),
      messages.help(123, false),
      messages.approvalsNeedDatabase(),
    ];
    for (const text of allMessages) expect(messages.looksLikeBotMessage(text), text.slice(0, 40)).toBe(true);
  });

  it('do not match ordinary notes', () => {
    expect(messages.looksLikeBotMessage('Everyone talks about 10% niacinamide...')).toBe(false);
    expect(messages.looksLikeBotMessage('Approve the new supplier contract')).toBe(false);
  });
});

describe('NEWS_USED marker', () => {
  it('is removed from the draft and read correctly', () => {
    expect(separateNewsMarker('Post text\n\nNEWS_USED: YES', true)).toEqual({ text: 'Post text', newsUsed: true });
    expect(separateNewsMarker('Post text\nNEWS_USED: no', true)).toEqual({ text: 'Post text', newsUsed: false });
    // Missing marker: assume used, so Meera still sees the source to check.
    expect(separateNewsMarker('Post text', true)).toEqual({ text: 'Post text', newsUsed: true });
    expect(separateNewsMarker('Post text', false)).toEqual({ text: 'Post text', newsUsed: false });
  });
});

describe('style check', () => {
  it('replaces em dashes with spaced hyphens and keeps number ranges tight', () => {
    expect(applyMechanicalFixes('The base—not the active—decides. Between 20–40% of users.')).toBe(
      'The base - not the active - decides. Between 20-40% of users.',
    );
    expect(applyMechanicalFixes('This is **important**.')).toBe('This is important.');
  });

  it('flags things Meera never does', () => {
    const warnings = checkDraftStyle('Here\'s the thing! Moreover; what do you think? #skincare ✨\n- bullet\nThe color changed.');
    expect(warnings.join(' | ')).toMatch(/words/);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'contains emoji',
        'contains hashtags',
        'contains an exclamation mark',
        'contains a semicolon',
        'contains bullet or numbered-list formatting',
        'asks the reader a question (her posts only report questions others asked)',
        'US spelling: color',
      ]),
    );
    expect(warnings.some((w) => w.includes('"here\'s the thing"') && w.includes('"moreover"'))).toBe(true);
  });

  it('allows a quoted question the reader could ask a brand', () => {
    expect(checkDraftStyle(`${SAMPLE_DRAFT} Ask them: "What pH is the finished product?"`)).toEqual([]);
  });

  it('finds placeholders left for Meera', () => {
    expect(findPlaceholders('We saw [DATA NEEDED: return rate] and [VERIFY: pH 3.5 threshold].')).toHaveLength(2);
  });
});

describe('removePlaceholderParagraphs', () => {
  it('drops the whole paragraph a placeholder sits in, including a dangling follow-up sentence in the same paragraph', () => {
    const text = [
      'First paragraph, no placeholder here.',
      'At Skinstinct, we [COMPANY PRACTICE NEEDED: how we handle this]. We do this because it matters.',
      'Final paragraph, also clean.',
    ].join('\n\n');
    expect(removePlaceholderParagraphs(text)).toBe('First paragraph, no placeholder here.\n\nFinal paragraph, also clean.');
  });

  it('drops multiple placeholder paragraphs and leaves everything else untouched', () => {
    const text = ['Clean one.', '[DATA NEEDED: return rate]', 'Clean two.', '[VERIFY: pH 3.5 threshold]', 'Clean three.'].join('\n\n');
    expect(removePlaceholderParagraphs(text)).toBe('Clean one.\n\nClean two.\n\nClean three.');
  });

  it('leaves text with no placeholder completely unchanged', () => {
    const text = 'Paragraph one.\n\nParagraph two.';
    expect(removePlaceholderParagraphs(text)).toBe(text);
  });
});

describe('voice-skill.txt', () => {
  it('exists, is substantial, and is built from her writing rather than generic advice', () => {
    const text = readVoiceFile();
    expect(text).not.toBeNull();
    expect(text!.length).toBeGreaterThan(10_000);
    expect(text).toContain('MEASURED FIGURES');
    expect(text).toContain('ANTI-VOICE');
    expect(text).toContain('Mean sentence length');
  });
});

describe('log redaction', () => {
  it('removes secret values and token-shaped strings from log lines', () => {
    const line = `calling https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage with key ${process.env.GEMINI_API_KEY}`;
    const clean = redact(line);
    expect(clean).not.toContain(process.env.TELEGRAM_BOT_TOKEN!);
    expect(clean).not.toContain(process.env.GEMINI_API_KEY!);
    expect(redact('bot7412938123:AABcdefghijklmnopqrstuvwxyz0123456789')).not.toContain('AABcdefghij');
    expect(redact('?key=AIzaSomething123&x=1')).toBe('?key=[REDACTED]&x=1');
    expect(redact('sk-ant-api03-abcdefghijklmnop')).toBe('[REDACTED KEY]');
  });

  it('is applied to console output', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return import('@/lib/logger').then(({ log }) => {
      log.error('TELEGRAM', 'failed', new Error(`token ${process.env.TELEGRAM_BOT_TOKEN} rejected`));
      expect(spy.mock.calls[0][0]).not.toContain(process.env.TELEGRAM_BOT_TOKEN!);
    });
  });
});

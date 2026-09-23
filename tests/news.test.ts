/** Google News RSS parsing. */
import { describe, expect, it } from 'vitest';
import { NewsSearchError } from '@/lib/errors';
import { parseGoogleNewsRss } from '@/lib/news';
import { rssFeed } from './helpers/fakeServices';

describe('parseGoogleNewsRss', () => {
  it('extracts headline (without the " - Source" suffix), source, date and link', () => {
    const [article] = parseGoogleNewsRss(rssFeed([{ title: 'New rules for sunscreen labels', source: 'The Hindu', daysAgo: 2 }]));
    expect(article.headline).toBe('New rules for sunscreen labels');
    expect(article.source).toBe('The Hindu');
    expect(article.url).toBe('https://news.google.com/rss/articles/test-0');
    expect(new Date(article.publishedAt).getTime()).toBeLessThan(Date.now());
    expect(article.summary).toBe(''); // the RSS description only repeats the headline
  });

  it('drops articles older than 30 days and duplicate headlines, newest first', () => {
    const articles = parseGoogleNewsRss(
      rssFeed([
        { title: 'Older story', source: 'A', daysAgo: 10 },
        { title: 'Ancient story', source: 'B', daysAgo: 45 },
        { title: 'Fresh story', source: 'C', daysAgo: 1 },
        { title: 'Fresh story', source: 'D', daysAgo: 1 },
      ]),
    );
    expect(articles.map((a) => a.headline)).toEqual(['Fresh story', 'Older story']);
  });

  it('handles an empty feed and a single item', () => {
    expect(parseGoogleNewsRss(rssFeed([]))).toEqual([]);
    expect(parseGoogleNewsRss(rssFeed([{ title: 'Only one', source: 'X', daysAgo: 1 }]))).toHaveLength(1);
  });

  it('throws NewsSearchError for something that is not RSS', () => {
    expect(() => parseGoogleNewsRss('<html><body>Captcha</body></html>')).toThrow(NewsSearchError);
  });
});

/**
 * A deterministic check of each draft against the hard, countable parts of
 * Meera's voice (from the Voice Skill's measured figures): no emojis,
 * hashtags, exclamation marks, semicolons, bullets or em dashes, no hype
 * words, British spelling, 350-550 words.
 *
 * Only purely mechanical punctuation is fixed automatically (em dashes →
 * spaced hyphens, stray markdown bold). Everything else is reported to Meera
 * as a warning - the words stay hers to change.
 */
import { countWords } from './validation';

export function applyMechanicalFixes(text: string): string {
  return (
    text
      // Her writing uses spaced hyphens, never em dashes. Number ranges keep a plain hyphen.
      .replace(/(\d)\s*[–—]\s*(\d)/g, '$1-$2')
      .replace(/\s*[—–]\s*/g, ' - ')
      // Markdown bold/italic markers would show up literally in LinkedIn.
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

const GENERIC_PHRASES = [
  "here's the thing",
  'let me tell you',
  "in today's fast-paced",
  'the truth is',
  'this changed everything',
  'let that sink in',
  'game-changing',
  'game changer',
  'revolutionary',
  'unlock',
  'empower',
  'must-have',
  'thrilled',
  'passionate',
  'my journey',
  'moreover',
  'furthermore',
  'additionally',
  'in conclusion',
];

// Common US spellings with an unambiguous British form.
const US_SPELLINGS = [
  'math', 'color', 'colors', 'flavor', 'behavior', 'favorite', 'center', 'organize', 'organized', 'realize', 'realized',
  'recognize', 'analyze', 'analyzed', 'optimize', 'optimized', 'emphasize', 'minimize', 'maximize', 'standardize',
  'standardized', 'stabilize', 'stabilized', 'sensitize', 'sensitization', 'utilize',
];

export function checkDraftStyle(text: string): string[] {
  const warnings: string[] = [];
  const lower = text.toLowerCase();
  const words = countWords(text);

  if (words < 350 || words > 550) warnings.push(`${words} words (her posts run 350-550)`);
  if (/\p{Extended_Pictographic}/u.test(text)) warnings.push('contains emoji');
  if (/(^|\s)#[a-z]/i.test(text)) warnings.push('contains hashtags');
  if (text.includes('!')) warnings.push('contains an exclamation mark');
  if (text.includes(';')) warnings.push('contains a semicolon');
  if (/^\s*([-•*]|\d+[.)])\s+/m.test(text)) warnings.push('contains bullet or numbered-list formatting');
  if (/^#{1,6}\s/m.test(text)) warnings.push('contains a heading');
  // Quoted questions (a question the reader could ask a brand) are fine; questions put to the reader aren't.
  const withoutQuotes = text.replace(/"[^"]*"|“[^”]*”/g, '');
  if (withoutQuotes.includes('?')) warnings.push('asks the reader a question (her posts only report questions others asked)');

  const phrases = GENERIC_PHRASES.filter((phrase) => lower.includes(phrase));
  if (phrases.length) warnings.push(`generic phrasing: ${phrases.map((p) => `"${p}"`).join(', ')}`);

  const spellings = US_SPELLINGS.filter((word) => new RegExp(`\\b${word}\\b`, 'i').test(text));
  if (spellings.length) warnings.push(`US spelling: ${spellings.join(', ')}`);

  return warnings;
}

/** Bracketed gaps the drafting model left for Meera, e.g. [DATA NEEDED: ...]. */
export function findPlaceholders(text: string): string[] {
  return text.match(/\[(?:DATA NEEDED|EXPERIENCE NEEDED|COMPANY PRACTICE NEEDED|VERIFY)[^\]]*\]/gi) ?? [];
}

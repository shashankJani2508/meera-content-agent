/**
 * Check the scoring prompt against notes whose right answer you know.
 *   npm run calibrate
 *
 * The case's rule of thumb: strong notes should score 6+, reminders and
 * half-thoughts 3 or below. If everything passes, the prompt is too lenient;
 * if strong notes fail, it's too strict. Edit prompts/scoring.ts and re-run.
 *
 * The sample notes below are made-up test cases, not Meera's real notes -
 * add her real ones (and whether each should pass) to make this sharper.
 */
import './loadEnv';
import { NOTE_SCORE_THRESHOLD } from '../lib/config';
import { scoreNote } from '../lib/stages/scoreNote';

const SAMPLES: Array<[note: string, shouldPass: boolean]> = [
  ["Most skincare brands talk about percentage concentration. But percentage alone doesn't tell you whether an active will actually work.", true],
  ["Everyone talks about 10% niacinamide, but the percentage on the label isn't enough to tell you whether the formulation will actually perform.", true],
  ['had a customer DM asking why our moisturiser feels different in monsoon. its the humectant pulling water from air, nobody explains this', true],
  ['"non-comedogenic" has no regulated test in India. brands just print it', true],
  ['batch 14 came back with pH 5.8 instead of 5.5. held the whole lot. cost us 3 weeks', true],
  ['Call supplier tomorrow.', false],
  ['Remember to pay GST before 20th', false],
  ['sunscreen post?', false],
  ['skincare is getting so confusing lol', false],
  ['meeting w/ Priya re packaging 3pm', false],
  ['loved the new cafe near the office', false],
  ['ceramides', false],
];

let correct = 0;
for (const [note, shouldPass] of SAMPLES) {
  const { score, reason } = await scoreNote(note);
  const passed = score >= NOTE_SCORE_THRESHOLD;
  if (passed === shouldPass) correct++;
  console.log(`${passed === shouldPass ? 'OK   ' : 'WRONG'} ${String(score).padStart(2)}/10  ${note.slice(0, 60)}\n                ${reason}`);
}
console.log(`\n${correct}/${SAMPLES.length} scored on the right side of ${NOTE_SCORE_THRESHOLD}.`);

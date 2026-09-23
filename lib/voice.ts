/**
 * Loads Meera's Voice Skill - the description of how she writes that the
 * drafting model follows.
 *
 * Where it comes from, in order:
 *   1. The active row in the Supabase voice_skill table.
 *   2. If that table is completely empty, voice-skill.txt is saved into it as
 *      version 1 (a one-time automatic seed) and used.
 *   3. If Supabase can't be read at all, voice-skill.txt is used directly.
 *
 * To change the voice later: edit voice-skill.txt and run `npm run voice:upload`
 * (or edit the row in Supabase). No code changes needed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isDatabaseConfigured } from './config';
import { countVoiceProfiles, getActiveVoiceProfile, publishVoiceProfile } from './database';
import { VoiceProfileMissingError } from './errors';
import { describeError, log } from './logger';
import type { VoiceProfile } from './types';

export const VOICE_FILE_NAME = 'voice-skill.txt';
/** Anything shorter than this is treated as a placeholder, not a real profile. */
const MIN_PROFILE_CHARS = 500;

function isUsable(text: string | null | undefined): text is string {
  return typeof text === 'string' && text.trim().length >= MIN_PROFILE_CHARS;
}

/** Read voice-skill.txt from the project root. Returns null if missing or too short. */
export function readVoiceFile(): string | null {
  try {
    const text = readFileSync(path.join(process.cwd(), VOICE_FILE_NAME), 'utf8');
    return isUsable(text) ? text.trim() : null;
  } catch {
    return null;
  }
}

export async function loadVoiceProfile(): Promise<VoiceProfile> {
  if (!isDatabaseConfigured()) {
    const fileText = readVoiceFile();
    if (fileText) {
      log.info('VOICE', 'Using voice-skill.txt (database not connected)');
      return { text: fileText, version: null, source: 'file' };
    }
    throw new VoiceProfileMissingError('Database not connected and voice-skill.txt is missing or empty');
  }

  try {
    const active = await getActiveVoiceProfile();
    if (active && isUsable(active.profile_text)) {
      log.info('VOICE', 'Using voice profile from Supabase', { version: active.version });
      return { text: active.profile_text, version: active.version, source: 'database' };
    }

    const fileText = readVoiceFile();
    if (fileText && (await countVoiceProfiles()) === 0) {
      const seeded = await publishVoiceProfile(fileText, VOICE_FILE_NAME);
      log.info('VOICE', 'voice_skill table was empty - seeded it from voice-skill.txt', { version: seeded.version });
      return { text: seeded.profile_text, version: seeded.version, source: 'database' };
    }
    if (fileText) {
      log.warn('VOICE', 'No active voice profile in Supabase - using voice-skill.txt');
      return { text: fileText, version: null, source: 'file' };
    }
  } catch (error) {
    log.warn('VOICE', 'Could not read voice profile from Supabase - trying voice-skill.txt', { error: describeError(error) });
    const fileText = readVoiceFile();
    if (fileText) return { text: fileText, version: null, source: 'file' };
  }

  throw new VoiceProfileMissingError('No voice profile: no active row in voice_skill and voice-skill.txt is missing or empty');
}

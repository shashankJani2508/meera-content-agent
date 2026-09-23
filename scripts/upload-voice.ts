/**
 * Save voice-skill.txt to Supabase as a new, active voice profile version.
 * Run this whenever you edit voice-skill.txt:   npm run voice:upload
 * Older versions stay in the voice_skill table (marked inactive).
 */
import './loadEnv';
import { publishVoiceProfile } from '../lib/database';
import { readVoiceFile, VOICE_FILE_NAME } from '../lib/voice';

const text = readVoiceFile();
if (!text) {
  console.error(`${VOICE_FILE_NAME} is missing or too short to be a real voice profile.`);
  process.exit(1);
}

const row = await publishVoiceProfile(text, VOICE_FILE_NAME);
console.log(`Voice profile version ${row.version} is now active (${text.length.toLocaleString()} characters).`);
console.log('New drafts will use it straight away - no redeploy needed.');

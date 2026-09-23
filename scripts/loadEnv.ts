/** Load .env for command-line scripts (Next.js does this itself for the app). */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
} else {
  console.warn('No .env file found - copy .env.example to .env and fill it in.');
}

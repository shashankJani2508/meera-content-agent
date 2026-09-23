import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // voice-skill.txt is read from disk at runtime (as the seed / fallback voice
  // profile). Vercel only bundles files it can see being imported, so we list
  // it explicitly to make sure it ships with the webhook function.
  outputFileTracingIncludes: {
    '/api/webhook': ['./voice-skill.txt'],
  },
};

export default nextConfig;

// examples/01-tts-basic.mjs — Basic TTS (lightning_v3.1, save WAV)
//
// Run from package root after `npm run build`:
//   SMALLEST_API_KEY=... node examples/01-tts-basic.mjs

import { generateSpeech } from 'ai';
import {
  smallestai,
  DEFAULT_LIGHTNING_MODEL,
} from '../dist/index.mjs';
import { writeFileSync } from 'node:fs';

const { audio } = await generateSpeech({
  model: smallestai.speech(DEFAULT_LIGHTNING_MODEL),
  text: 'Hello from the Smallest AI Vercel SDK.',
  voice: 'sophia',
});

const out = '/tmp/example-tts.wav';
writeFileSync(out, Buffer.from(audio.uint8Array));
console.log(`wrote ${audio.uint8Array.length} bytes → ${out}`);

// examples/06-voice-clone.mjs — Full voice-clone lifecycle:
// create → list → use in TTS → delete.
//
// First run 01-tts-basic.mjs (writes /tmp/example-tts.wav), then:
//   SMALLEST_API_KEY=... node examples/06-voice-clone.mjs

import { generateSpeech } from 'ai';
import {
  smallestai,
  DEFAULT_LIGHTNING_MODEL,
} from '../dist/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const buf = readFileSync('/tmp/example-tts.wav');

// 1. Create an instant voice clone
console.log('creating clone...');
const clone = await smallestai.voiceClone.create({
  file: buf,
  fileName: `e2e-${Date.now()}.wav`,
  displayName: `e2e-clone-${Date.now()}`,
  description: 'SDK example clone',
  language: 'en',
  model: 'lightning_v3.1',
});
console.log(`  voiceId=${clone.voiceId}, status=${clone.status}`);

// 2. List clones to confirm it's visible
const all = await smallestai.voiceClone.list();
console.log(`list: ${all.length} clones in your org`);
const found = all.find((c) => c.voiceId === clone.voiceId);
console.log(`  newly created clone is ${found ? 'visible' : 'NOT visible (try refresh)'}`);

// 3. Synthesize speech with the cloned voice
console.log('synthesizing with cloned voice...');
const { audio } = await generateSpeech({
  model: smallestai.speech(DEFAULT_LIGHTNING_MODEL),
  text: 'Hello — this is the cloned voice speaking.',
  voice: clone.voiceId,
  providerOptions: { smallestai: { outputFormat: 'mp3' } },
});
const out = '/tmp/example-cloned-voice.mp3';
writeFileSync(out, Buffer.from(audio.uint8Array));
console.log(`  wrote ${audio.uint8Array.length} bytes → ${out}`);

// 4. Delete the clone (cleanup)
console.log('deleting clone...');
const res = await smallestai.voiceClone.delete(clone.voiceId);
console.log(`  delete success=${res.success} voiceId=${res.voiceId ?? clone.voiceId}`);

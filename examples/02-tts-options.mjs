// examples/02-tts-options.mjs — TTS with provider options
//
//   SMALLEST_API_KEY=... node examples/02-tts-options.mjs

import { generateSpeech } from 'ai';
import {
  smallestai,
  DEFAULT_LIGHTNING_MODEL,
} from '../dist/index.mjs';
import { writeFileSync } from 'node:fs';

const { audio, warnings } = await generateSpeech({
  model: smallestai.speech(DEFAULT_LIGHTNING_MODEL),
  text: 'This is robert reading with custom output options.',
  voice: 'robert',
  speed: 1.0,
  providerOptions: {
    smallestai: {
      sampleRate: 24000,        // 8000 | 16000 | 24000 | 44100
      outputFormat: 'mp3',      // pcm | mp3 | wav | mulaw (→ ulaw) | alaw | ulaw
      // pronunciationDicts: ['<dict-id-1>', '<dict-id-2>'],
    },
  },
});

writeFileSync('/tmp/example-tts.mp3', Buffer.from(audio.uint8Array));
console.log(
  `wrote ${audio.uint8Array.length} bytes mp3, ${warnings.length} warning(s)`,
);
if (warnings.length) console.log(warnings);

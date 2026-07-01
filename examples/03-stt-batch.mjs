// examples/03-stt-batch.mjs — Batch STT with the full feature set
//
// First run 01-tts-basic.mjs (writes /tmp/example-tts.wav), then:
//   SMALLEST_API_KEY=... node examples/03-stt-batch.mjs

import { transcribe } from 'ai';
import { smallestai } from '../dist/index.mjs';
import { readFileSync } from 'node:fs';

const audioBuffer = readFileSync('/tmp/example-tts.wav');

// 'pulse' = 38 languages + streaming. For max-accuracy English batch
// transcription, swap in smallestai.transcription('pulse-pro').
const { text, segments, durationInSeconds, warnings } = await transcribe({
  model: smallestai.transcription('pulse'),
  audio: audioBuffer,
  mediaType: 'audio/wav',
  providerOptions: {
    smallestai: {
      language: 'en',           // 'en' | 'hi' | 'multi' | 30+ ISO codes
      diarize: true,
      emotionDetection: true,
      genderDetection: true,
      wordTimestamps: true,

      // Privacy
      redactPii: true,          // names/addresses → [FIRSTNAME_1] etc.
      redactPci: true,          // card #s/CVV → [CREDITCARDCVV_1] etc.

      // Formatting
      numerals: 'auto',
      punctuate: true,
      capitalize: true,

      // Keyword boosting (max 100; "WORD:INTENSIFIER")
      keywords: ['Smallest:5', 'Lightning'],
    },
  },
});

console.log('transcript :', text);
console.log('duration   :', durationInSeconds, 's');
console.log('segments   :', segments.length, 'words');
if (warnings.length) console.log('warnings :', warnings);

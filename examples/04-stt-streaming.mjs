// examples/04-stt-streaming.mjs — Streaming WS STT, accumulating fullTranscript client-side
//
// Generate a raw PCM source first:
//   ffmpeg -i /tmp/example-tts.wav -f s16le -acodec pcm_s16le -ac 1 -ar 16000 /tmp/example.s16le
//
//   SMALLEST_API_KEY=... node examples/04-stt-streaming.mjs

import { smallestai } from '../dist/index.mjs';
import { readFileSync } from 'node:fs';

const PCM = '/tmp/example.s16le';
const pcm = readFileSync(PCM);

const stream = smallestai.transcriptionStream('pulse', {
  language: 'en',
  encoding: 'linear16',
  sampleRate: 16000,
  wordTimestamps: true,
  diarize: true,
  redactPii: true,
  redactPci: true,
  numerals: 'auto',
  itnNormalize: true,
  sentenceTimestamps: true,
  keywords: ['lightning', 'kilohertz'],
});

await stream.connect();
console.log('connected');

// Stream chunks at a realistic pace so partials are visible.
const CHUNK = 16 * 1024; // 0.5s @ 16k mono s16le
(async () => {
  for (let i = 0; i < pcm.length; i += CHUNK) {
    stream.sendAudio(pcm.subarray(i, Math.min(i + CHUNK, pcm.length)));
    await new Promise((r) => setTimeout(r, 50));
  }
  stream.closeStream();
})();

// Accumulate the full transcript client-side from is_final frames
// (server-side `full_transcript` field returns empty for now — see the
// "Patterns & Caveats" section in the integration doc).
let fullTranscript = '';
for await (const msg of stream) {
  if (!msg.is_final) {
    console.log('partial :', msg.transcript);
  } else {
    console.log('final   :', msg.transcript);
    fullTranscript += (fullTranscript ? ' ' : '') + (msg.transcript || '');
  }
  if (msg.is_last) break;
}
console.log('---');
console.log('full transcript:', fullTranscript);

// examples/05-stt-streaming-oneshot.mjs — One-shot streaming for pre-recorded audio
//
//   SMALLEST_API_KEY=... node examples/05-stt-streaming-oneshot.mjs

import {
  smallestai,
  SmallestAITranscriptionStream,
} from '../dist/index.mjs';
import { readFileSync } from 'node:fs';

const pcm = readFileSync('/tmp/example.s16le');

const stream = smallestai.transcriptionStream('pulse', {
  language: 'en',
  encoding: 'linear16',
  sampleRate: 16000,
  wordTimestamps: true,
  sentenceTimestamps: true,
  itnNormalize: true,
});

const t0 = Date.now();
const { transcript, messages } =
  await SmallestAITranscriptionStream.transcribeOnce(stream, pcm);
const ms = Date.now() - t0;

console.log('transcript :', transcript);
console.log('messages   :', messages.length);
console.log('end-to-end :', ms, 'ms (audio length ~5s)');

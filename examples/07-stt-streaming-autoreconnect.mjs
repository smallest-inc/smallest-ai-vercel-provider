// examples/07-stt-streaming-autoreconnect.mjs — Long-form streaming with
// automatic reconnect on socket drops. Demonstrates the synthetic
// `{ type: 'reconnected', attempt }` frame the SDK emits after recovery.
//
//   SMALLEST_API_KEY=... node examples/07-stt-streaming-autoreconnect.mjs
//
// To actually exercise reconnect logic against the live server, you'd
// need to drop the socket mid-stream — easier to do with the unit
// tests in test-e2e.mjs (which uses a fake WS factory). This script
// shows the consumer-side handling pattern.

import { smallestai } from '../dist/index.mjs';
import { readFileSync } from 'node:fs';

const pcm = readFileSync('/tmp/example.s16le');

const stream = smallestai.transcriptionStream('pulse', {
  language: 'en',
  encoding: 'linear16',
  sampleRate: 16000,
  wordTimestamps: true,
  itnNormalize: true,

  // ── Reconnect knobs ────────────────────────────────────────────────
  autoReconnect: true,
  maxReconnectAttempts: 5,    // give up after this many tries
  reconnectBackoffMs: 500,    // exponential backoff, capped at 30s
});

await stream.connect();
console.log('connected');

// Stream chunks at a realistic pace.
const CHUNK = 16 * 1024;
(async () => {
  for (let i = 0; i < pcm.length; i += CHUNK) {
    stream.sendAudio(pcm.subarray(i, Math.min(i + CHUNK, pcm.length)));
    await new Promise((r) => setTimeout(r, 50));
  }
  stream.closeStream();
})();

let fullTranscript = '';
let reconnects = 0;
for await (const msg of stream) {
  if (msg.type === 'reconnected') {
    reconnects++;
    console.log(`recovered (attempt ${msg.attempt})`);
    continue;
  }
  if (!msg.is_final) {
    process.stdout.write('.');
  } else if (msg.transcript) {
    fullTranscript += (fullTranscript ? ' ' : '') + msg.transcript;
    console.log(`\n[final] ${msg.transcript}`);
  }
  if (msg.is_last) break;
}

console.log('---');
console.log(`done. reconnects: ${reconnects}`);
console.log(`full transcript: ${fullTranscript}`);

import {
  smallestai,
  createTranscriptionStreamSSEResponse,
} from 'smallestai-vercel-provider';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const audio = new Uint8Array(await req.arrayBuffer());

  const stream = smallestai.transcriptionStream('pulse', {
    language: 'en',
    encoding: 'linear16',
    sampleRate: 16000,
    wordTimestamps: true,
    sentenceTimestamps: true,
    itnNormalize: true,
    redactPii: true,

    // Optional: harden against socket drops on long-running sessions.
    autoReconnect: true,
    maxReconnectAttempts: 5,
  });
  await stream.connect();

  // Pump audio in fast, then close. For real-time mic streams, you'd
  // pipe an upstream `ReadableStream` instead — see the SDK README's
  // "Streaming caveats" section for the mic capture pattern.
  for (let i = 0; i < audio.length; i += 32 * 1024) {
    stream.sendAudio(audio.subarray(i, i + 32 * 1024));
  }
  stream.closeStream();

  // Forward every server frame back to the browser as Server-Sent
  // Events. signal: req.signal closes the upstream WS if the browser
  // disconnects mid-stream.
  return createTranscriptionStreamSSEResponse(stream, { signal: req.signal });
}

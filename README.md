# smallestai-vercel-provider

Vercel AI SDK provider for [Smallest AI](https://smallest.ai) — ultra-fast text-to-speech (Lightning) and speech-to-text (Pulse).

- **TTS**: Sub-100ms latency, 30+ languages, voice cloning
- **STT**: 64ms TTFT, speaker diarization, emotion detection

## Installation

```bash
npm install smallestai-vercel-provider
```

## Setup

Get your API key from [waves.smallest.ai](https://waves.smallest.ai), then set it as an environment variable:

```bash
export SMALLEST_API_KEY="your_key_here"
```

Or pass it directly:

```ts
import { createSmallestAI } from 'smallestai-vercel-provider';

const smallestai = createSmallestAI({ apiKey: 'your_key_here' });
```

## Text-to-Speech

```ts
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { smallestai } from 'smallestai-vercel-provider';

const { audio } = await generateSpeech({
  model: smallestai.speech('lightning-v3.1'),
  text: 'Hello from Smallest AI!',
  voice: 'sophia',
  speed: 1.0,
});

// audio.uint8Array — raw audio bytes
// audio.base64 — base64-encoded audio
```

### Models

| Model ID | Description |
|---|---|
| `lightning-v3.1` | 44.1 kHz, natural expressive speech, 22 languages with auto-detect |

You can also import the model name as a constant:

```ts
import { DEFAULT_LIGHTNING_MODEL, smallestai } from 'smallestai-vercel-provider';

const model = smallestai.speech(DEFAULT_LIGHTNING_MODEL);
```

### Voices

| Voice | Gender | Accent | Best For |
|---|---|---|---|
| `sophia` | Female | American | General use (default) |
| `robert` | Male | American | Announcements, briefings |
| `advika` | Female | Indian | Hindi, code-switching |
| `vivaan` | Male | Indian | Bilingual English/Hindi |
| `camilla` | Female | Mexican/Latin | Spanish content |

80+ more voices available. See [API docs](https://docs.smallest.ai/waves).

### Provider Options

```ts
const { audio } = await generateSpeech({
  model: smallestai.speech('lightning-v3.1'),
  text: 'Hello!',
  voice: 'robert',
  providerOptions: {
    smallestai: {
      sampleRate: 44100,         // 8000 | 16000 | 24000 | 44100
      similarity: 0.5,           // 0–1
      enhancement: 1,            // 0 | 1 | 2
      outputFormat: 'mp3',       // pcm | mp3 | wav | mulaw | alaw
      addWavHeader: false,
      saveHistory: false,
      pronunciationDicts: ['<dict-id>'],
    },
  },
});
```

## Speech-to-Text

```ts
import { experimental_transcribe as transcribe } from 'ai';
import { smallestai } from 'smallestai-vercel-provider';
import { readFileSync } from 'fs';

const audioBuffer = readFileSync('recording.wav');

const { text, segments } = await transcribe({
  model: smallestai.transcription('pulse'),
  audio: audioBuffer,
  mediaType: 'audio/wav',
});

console.log(text);
```

### Provider Options

```ts
const result = await transcribe({
  model: smallestai.transcription('pulse'),
  audio: audioBuffer,
  mediaType: 'audio/wav',
  providerOptions: {
    smallestai: {
      language: 'multi',         // 'en' | 'hi' | 'multi' | … (auto-detect with 'multi')
      diarize: true,
      emotionDetection: true,
      genderDetection: true,
      wordTimestamps: true,

      // Privacy
      redactPii: true,           // names, addresses → [FIRSTNAME_1] etc.
      redactPci: true,           // card #s, CVV → [CREDITCARDCVV_1] etc.

      // Formatting
      numerals: 'auto',          // 'true' | 'false' | 'auto'
      punctuate: true,
      capitalize: true,

      // Keyword boosting (max 100; "WORD:INTENSIFIER")
      keywords: ['NVIDIA:5', 'Jensen:4'],

      // Streaming/WS-only knobs (forwarded for forward-compat; REST currently ignores)
      itnNormalize: true,
      sentenceTimestamps: true,
      fullTranscript: true,

      // Async webhook delivery
      webhookUrl: 'https://example.com/asr-webhook',
      webhookMethod: 'POST',
      webhookExtra: 'job_id:abc123',
    },
  },
});
```

> Note: `ageDetection` has been removed from the server API and will emit a warning.

## Streaming Speech-to-Text (WebSocket)

For low-latency / real-time transcription (TTFT ~64ms server-side), use the WS API. Forwards every WS-only flag — `itnNormalize`, `sentenceTimestamps`, `fullTranscript`, `finalizeOnWords`, `maxWords` — over an authenticated WebSocket per the [docs canon](https://docs.smallest.ai/v4.0.0/content/speech-to-text/realtime/quickstart).

```ts
import { smallestai } from 'smallestai-vercel-provider';
import { readFileSync } from 'fs';

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
  keywords: ['NVIDIA:5', 'Jensen'],
});

await stream.connect();

// Stream audio chunks (raw PCM s16le @ 16k mono in this example)
const pcm = readFileSync('audio.s16le');
for (let i = 0; i < pcm.length; i += 32 * 1024) {
  stream.sendAudio(pcm.subarray(i, i + 32 * 1024));
}
stream.closeStream(); // server flushes, emits is_last: true, then closes

for await (const msg of stream) {
  if (!msg.is_final) console.log('partial:', msg.transcript);
  else console.log('final:', msg.transcript, 'words:', msg.words?.length);
  if (msg.is_last) break;
}
```

### Auto-reconnect on socket drops

Long-running streams (live meetings, hours-long captures) can hit
network blips, idle timeouts, or load-balancer recycles. Pass
`autoReconnect: true` and the SDK transparently re-opens with the same
parameters, then synthesizes a `{ type: 'reconnected', attempt }` frame
so your consumer can react (show a reconnecting indicator, etc.):

```ts
const stream = smallestai.transcriptionStream('pulse', {
  language: 'en',
  encoding: 'linear16',
  sampleRate: 16000,
  autoReconnect: true,
  maxReconnectAttempts: 5,    // default 5
  reconnectBackoffMs: 500,    // exponential backoff, capped at 30s
});

for await (const msg of stream) {
  if (msg.type === 'reconnected') {
    console.log(`recovered after ${msg.attempt} attempt(s)`);
    continue;
  }
  // ... normal transcript handling
}
```

### One-shot helper for pre-recorded audio

```ts
import {
  smallestai,
  SmallestAITranscriptionStream,
} from 'smallestai-vercel-provider';

const stream = smallestai.transcriptionStream('pulse', {
  language: 'en', encoding: 'linear16', sampleRate: 16000,
  wordTimestamps: true, sentenceTimestamps: true, itnNormalize: true,
});

const { transcript, messages } =
  await SmallestAITranscriptionStream.transcribeOnce(stream, audioBytes);

console.log(transcript);
```

### Streaming caveats & how to handle them

#### 1. `fullTranscript` — accumulate client-side

The server accepts `fullTranscript: true` as a query flag, but the
`full_transcript` field is currently returned as an empty string.
Until the server populates it, accumulate the transcript yourself by
concatenating every `is_final: true` frame's `transcript`:

```ts
let fullTranscript = '';
for await (const msg of stream) {
  if (msg.is_final && msg.transcript) {
    fullTranscript += (fullTranscript ? ' ' : '') + msg.transcript;
  }
  if (msg.is_last) break;
}
console.log('full transcript:', fullTranscript);
```

The built-in `transcribeOnce()` helper does exactly this — use it for
the pre-recorded case and you don't have to think about it.

#### 2. Streaming is Node-only — proxy from the browser

`smallestai.transcriptionStream()` opens a WebSocket with an
`Authorization: Bearer ...` header. Browser-native `WebSocket` cannot
set headers (it's a fundamental browser limitation, not an SDK
choice), so this method only works server-side. Browser apps should
proxy through their own server.

The SDK ships a one-line `createTranscriptionStreamSSEResponse()`
helper that turns the stream into a `Response` of Server-Sent Events,
so the entire proxy is a few lines:

```ts
// app/api/transcribe-stream/route.ts (Next.js, Node runtime)
import {
  smallestai,
  createTranscriptionStreamSSEResponse,
} from 'smallestai-vercel-provider';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const audio = new Uint8Array(await req.arrayBuffer());
  const stream = smallestai.transcriptionStream('pulse', {
    language: 'en',
    encoding: 'linear16',
    sampleRate: 16000,
    wordTimestamps: true,
    itnNormalize: true,
  });
  await stream.connect();
  for (let i = 0; i < audio.length; i += 32 * 1024) {
    stream.sendAudio(audio.subarray(i, i + 32 * 1024));
  }
  stream.closeStream();
  return createTranscriptionStreamSSEResponse(stream, { signal: req.signal });
}
```

The browser opens this same-origin endpoint and parses the SSE stream
back into messages with the matching helper:

```ts
import { parseTranscriptionStreamSSE } from 'smallestai-vercel-provider';

const res = await fetch('/api/transcribe-stream', { method: 'POST', body: audioBytes });
for await (const msg of parseTranscriptionStreamSSE(res)) {
  if (msg.is_final) console.log(msg.transcript);
  if (msg.is_last) break;
}
```

No API key in the browser, no header restriction, no SDK in the
client bundle. If you're using React, use the `useTranscriptionStream`
hook instead — it handles the fetch + parse + accumulation for you.

### Next.js setup note (one-time)

Next.js's webpack tries to bundle the `ws` package and breaks its
optional native bindings. Add this once to `next.config.{js,mjs,ts}`:

```js
// next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['smallestai-vercel-provider', 'ws'],
};
export default nextConfig;
```

And install the optional native deps so `ws` masks frames at native
speed:

```bash
npm install bufferutil utf-8-validate
```

## React hooks (`smallestai-vercel-provider/react`)

Three hooks for client components — none of them call the SDK
directly, so the API key never reaches the browser. Each pairs with a
server-side route you wire up.

```tsx
'use client';

import {
  useSpeech,
  useTranscriptionStream,
  useVoiceClone,
} from 'smallestai-vercel-provider/react';
```

### `useSpeech({ apiPath })`

```tsx
const { audioUrl, isLoading, error, generate, reset } = useSpeech({
  apiPath: '/api/speak', // your TTS route, returns audio bytes
});

await generate({ text: 'Hello!', voice: 'sophia' });
return <audio controls src={audioUrl ?? undefined} />;
```

### `useTranscriptionStream({ apiPath })`

Pairs with `createTranscriptionStreamSSEResponse()` on the server.
Auto-accumulates the running transcript from `is_final` frames and
exposes the latest partial separately.

```tsx
const {
  transcript,         // accumulated final transcript
  partial,            // current in-progress utterance
  messages,           // every raw frame
  isStreaming,
  error,
  transcribe,
  cancel,
  reset,
} = useTranscriptionStream({ apiPath: '/api/transcribe-stream' });

// kick off
const finalText = await transcribe(audioBlob);

return (
  <>
    <p>{transcript}</p>
    {partial && <em>{partial}</em>}
    {isStreaming && <button onClick={cancel}>Stop</button>}
  </>
);
```

### `useVoiceClone({ apiPath })`

Pairs with three server routes (`POST /api/voice-clone` for create,
`GET` for list, `POST /api/voice-clone/delete`) that mirror calls onto
`smallestai.voiceClone.{create, list, delete}`.

```tsx
const { clones, create, remove, refresh, isLoading } = useVoiceClone({
  apiPath: '/api/voice-clone',
});

const newClone = await create({
  file: voiceFile,
  displayName: 'My voice',
  language: 'en',
});

return (
  <ul>
    {clones.map(c => (
      <li key={c.voiceId}>
        {c.displayName} <button onClick={() => remove(c.voiceId)}>Delete</button>
      </li>
    ))}
  </ul>
);
```

## Voice Cloning

```ts
import { smallestai } from 'smallestai-vercel-provider';
import { readFileSync } from 'fs';

// Create a new instant clone
const clone = await smallestai.voiceClone.create({
  file: readFileSync('my-voice.wav'),
  fileName: 'my-voice.wav',
  displayName: 'My voice',
  description: 'Warm narrator',
  language: 'en',
});
console.log(clone.voiceId); // → "voice_abc123"

// List all clones in your org
const all = await smallestai.voiceClone.list();

// Use it as a voice in TTS
const { audio } = await generateSpeech({
  model: smallestai.speech('lightning-v3.1'),
  text: 'Hello in my own voice.',
  voice: clone.voiceId,
});

// Delete when you're done
await smallestai.voiceClone.delete(clone.voiceId);
```

## Examples

### Next.js API Route — TTS endpoint

```ts
// app/api/speak/route.ts
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { smallestai } from 'smallestai-vercel-provider';

export async function POST(req: Request) {
  const { text, voice } = await req.json();

  const { audio } = await generateSpeech({
    model: smallestai.speech('lightning-v3.1'),
    text,
    voice: voice || 'sophia',
  });

  return new Response(audio.uint8Array, {
    headers: {
      'Content-Type': 'audio/wav',
      'Content-Disposition': 'inline; filename="speech.wav"',
    },
  });
}
```

### Frontend — Play audio in browser

```tsx
// components/SpeakButton.tsx
'use client';

export function SpeakButton({ text }: { text: string }) {
  const speak = async () => {
    const res = await fetch('/api/speak', {
      method: 'POST',
      body: JSON.stringify({ text, voice: 'sophia' }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    new Audio(url).play();
  };

  return <button onClick={speak}>Speak</button>;
}
```

### Next.js API Route — Transcription endpoint

```ts
// app/api/transcribe/route.ts
import { experimental_transcribe as transcribe } from 'ai';
import { smallestai } from 'smallestai-vercel-provider';

export async function POST(req: Request) {
  const formData = await req.formData();
  const file = formData.get('audio') as File;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { text, segments } = await transcribe({
    model: smallestai.transcription('pulse'),
    audio: buffer,
    mediaType: file.type || 'audio/wav',
  });

  return Response.json({ text, segments });
}
```

### Node.js Script — Save to file

```ts
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { smallestai } from 'smallestai-vercel-provider';
import { writeFileSync } from 'fs';

const { audio } = await generateSpeech({
  model: smallestai.speech('lightning-v3.1'),
  text: 'Hello from Smallest AI!',
  voice: 'sophia',
});

writeFileSync('output.wav', Buffer.from(audio.uint8Array));
console.log('Saved to output.wav');
```

## Roadmap

Future / deferred — open an issue if any of these would unblock you:

- **Browser-native streaming** — direct browser WebSocket without proxying. Blocked on the platform: native browser `WebSocket` can't set the `Authorization` header, so we'd need a short-lived signed-token endpoint server-side. Until that exists, the SSE-proxy + `useTranscriptionStream` flow is the recommended path (and just as fast in practice).
- **First-class microphone capture hook** — `useMicrophoneTranscription()` that wraps `getUserMedia` + `MediaRecorder` + `useTranscriptionStream` into one call.
- **Built-in chunk batching for slow consumers** — backpressure-aware send queue so a chatty mic stream can't outrun the WS.

## Links

- [Smallest AI](https://smallest.ai)
- [API Docs](https://docs.smallest.ai/waves)
- [Vercel AI SDK Integration Guide](https://docs.smallest.ai/v4.0.0/content/integrations/vercel-ai-sdk)
- [Get API Key](https://waves.smallest.ai)
- [Vercel AI SDK](https://ai-sdk.dev)
- [Runnable examples](./examples)

## License

Apache-2.0

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
import { LightningV31Language } from 'smallestai-vercel-provider';

const language: LightningV31Language = 'auto'; // type-checked against the v3.1 enum

const { audio } = await generateSpeech({
  model: smallestai.speech('lightning-v3.1'),
  text: 'Hello!',
  voice: 'robert',
  language,
  providerOptions: {
    smallestai: {
      sampleRate: 44100,         // 8000 | 16000 | 24000 | 44100
      similarity: 0.5,           // 0–1
      enhancement: 1,            // 0 | 1 | 2
      outputFormat: 'mp3',       // 'pcm' | 'mp3' | 'wav' | 'ulaw' | 'alaw' | 'mulaw' (alias of 'ulaw')
      addWavHeader: false,
      saveHistory: false,
      pronunciationDicts: ['<dict-id>'],
    },
  },
});
```

> **`outputFormat: 'mulaw'`** is accepted as a friendly alias and normalized to `'ulaw'` before POST — the server enum is `['wav', 'ulaw', 'alaw', 'pcm', 'mp3']`.
>
> **`LIGHTNING_V3_1_LANGUAGES`** is also exported as a runtime tuple if you want to render the supported list (e.g. in a language picker):
>
> ```ts
> import { LIGHTNING_V3_1_LANGUAGES } from 'smallestai-vercel-provider';
> // ['auto', 'en', 'hi', 'mr', 'kn', 'ta', 'bn', 'gu', 'de', 'fr', 'es', 'it',
> //  'pl', 'nl', 'ru', 'ar', 'he', 'sv', 'ml', 'te', 'pt', 'pa', 'or']
> ```

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

      // Async webhook delivery
      webhookUrl: 'https://example.com/asr-webhook',
      webhookMethod: 'POST',
      webhookExtra: 'job_id:abc123',
    },
  },
});
```

> **WS-only knobs** — `itnNormalize`, `sentenceTimestamps`, `fullTranscript`, `finalizeOnWords`, `maxWords` — are not accepted on the batch endpoint (the server schema doesn't list them; passing them is a TS error on `transcribe()`). Use them on `smallestai.transcriptionStream(...)` instead — see the Streaming section below.

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

#### 2. Browser streaming — three options

The default `transcriptionStream()` flow uses an `Authorization: Bearer`
header which native browser `WebSocket` can't set. Three options for
browser apps, in order of recommendation:

#### A. Proxy via your server (recommended for production)

Your server holds the API key, browser never sees it.

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

#### B. Browser-native via signed URL (also production-grade)

Your server mints a short-lived signed URL on demand; the browser
opens the WebSocket directly with that URL. Same security profile as
(A) but with one less hop:

```ts
// Browser code:
import { smallestai } from 'smallestai-vercel-provider';

const stream = smallestai.transcriptionStream('pulse', {
  language: 'en',
  encoding: 'linear16',
  sampleRate: 16000,
}, {
  signedUrl: async () => {
    const res = await fetch('/api/get-stream-url');
    return (await res.json()).url; // wss://api.smallest.ai/...?token=...
  },
});
await stream.connect();
// ... same `for await` loop as Node code
```

The `signedUrl` callback is called on every `connect()` and on every
reconnect, so each session uses a fresh URL. **Server side**: your
`/api/get-stream-url` builds the URL with a short-lived token
parameter; the platform's WS auth accepts the token via query.

#### C. Browser-native with `auth: 'query'` (dev / internal apps only)

The simplest path for a quick demo: the SDK puts the API key directly
in the URL and uses native `WebSocket`.

```ts
const stream = smallestai.transcriptionStream('pulse', {
  language: 'en',
  encoding: 'linear16',
  sampleRate: 16000,
}, {
  apiKey: 'sk_...',
  auth: 'query', // skip the Authorization header path
});
```

> ⚠️ The API key appears in the WebSocket URL — visible in browser
> devtools, history, server access logs, and any error reporting tool
> that captures URLs. Use only for dev and internal apps. For end-user
> production, use option (A) or (B).

### React hooks for the browser

If you're shipping a React app, skip the manual fetch + parse:

- `useTranscriptionStream({ apiPath })` — the simplest streaming
  client; talks to your option-(A) SSE proxy.
- `useMicrophonePCM()` — captures the mic via AudioWorklet and yields
  raw PCM `Uint8Array` chunks. Pair with anything: a custom WS, the
  proxy, or your own batching.
- `useMicrophoneTranscription({ apiPath })` — the all-in-one. Captures
  mic, streams chunks to your SSE proxy as the request body, exposes
  live `transcript` + `partial` state. See the [Mic capture →
  transcription](#mic-capture--transcription-with-react) section
  below.

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

## Mic capture → transcription with React

Browser apps that want continuous mic transcription (live captions, voice agents, push-to-talk) get the whole thing wired up by one hook:

```tsx
'use client';
import { useMicrophoneTranscription } from 'smallestai-vercel-provider/react';

export function LiveCaptions() {
  const {
    transcript, partial, isCapturing, isStreaming,
    chunksDelivered, chunksDropped,
    start, stop, reset,
  } = useMicrophoneTranscription({ apiPath: '/api/transcribe-mic-stream' });

  return (
    <>
      <button onClick={isCapturing ? stop : () => start()}>
        {isCapturing ? 'Stop' : 'Start'}
      </button>
      <p>{transcript}{partial && <em> {partial}</em>}</p>
      {chunksDropped > 0 && <small>⚠ {chunksDropped} chunks dropped (lagging)</small>}
    </>
  );
}
```

The hook captures via `getUserMedia` + `AudioWorklet`, downsamples to `linear16` @ 16 kHz mono, batches into ~100 ms chunks, and POSTs them as a streaming `ReadableStream` request body to your endpoint. The endpoint pipes those chunks into `smallestai.transcriptionStream(...)` and returns the live transcript via SSE. Drop-oldest backpressure means a slow network never balloons memory — the consumer sees `chunksDropped` go up and can show a "lagging" indicator.

For just the mic capture (no transcription wiring), use the lower-level [`useMicrophonePCM()`](src/react/use-microphone-pcm.ts) hook and pipe `Uint8Array` chunks anywhere you like.

## Security

This section documents what the SDK protects against and what stays the consumer's job. Read it before deploying browser-side flows.

### Threat model

| Threat | Mitigated by |
|---|---|
| **TLS-stripping on streaming WS** — `ws://` instead of `wss://` lets a network attacker MITM audio | SDK refuses non-`wss:` URLs from `signedUrl()`. `ws://localhost` only works if you explicitly add `'localhost'` to `allowedSignedHosts`. |
| **Wrong-host redirect** — bug in your `signedUrl` endpoint sends audio to `attacker.com` | SDK rejects URLs whose host doesn't match `baseURL` (or your explicit `allowedSignedHosts`). |
| **Signing endpoint hangs** → infinite stall | `signedUrlTimeoutMs` (default 10 s, hard-capped at 60 s) — fast-fail with a clear error. |
| **API key in browser bundle** | Default flow uses `Authorization: Bearer` server-side only. `auth: 'query'` puts the key in the URL — the SDK emits a one-time `console.warn` so it can't be deployed unnoticed. Suppress the warning only after you've audited the deployment via `suppressInsecureAuthWarning: true`. |
| **Stale signed URL on reconnect** — short-lived token expired during a long session | `signedUrl()` is called on **every** reconnect, never cached. |
| **Race: double `connect()` call** | Internal `openPromise` deduplicates; second call returns the same Promise. |
| **TLS verification of the WS** | Native `WebSocket` and the `ws` package both delegate to the runtime's TLS stack. Cannot be disabled by the SDK. |

### What stays your job

- **CSRF-protect your SSE proxy endpoint** (and any `signedUrl` mint endpoint). The SDK can't enforce origin checks for you.
- **Rate-limit your proxy endpoint.** A malicious client can spam your route to burn your Smallest API budget; gate it behind your auth + per-user rate limits.
- **Audit `auth: 'query'` deployments.** If you opt into it, make sure the API key is per-user-scoped and rotatable. Don't put a master org key in a public-facing browser bundle.
- **Pick `signedUrl` token TTLs short.** Recommended: 60 s. The token only needs to live long enough for the browser to open the WS.
- **Restrict `allowedSignedHosts` to hosts you control.** Never include user-controlled values.

### What the SDK does *not* do

- **Mint signed URLs.** Your `signedUrl()` callback is the single source of truth — the SDK delegates URL construction entirely. How you sign / scope / expire those URLs is up to you. Open an [issue](https://github.com/smallest-inc/smallest-ai-vercel-provider/issues) if you want a worked example.
- **Encrypt audio at rest.** Audio rides over `wss://` in flight; what the server does with it is documented at [docs.smallest.ai](https://docs.smallest.ai).

## Roadmap

Future / deferred — open an issue if any of these would unblock you:

- **Voice activity detection on `useMicrophonePCM`** — drop silent chunks before send, save WS bandwidth + ASR costs.
- **`useTextToSpeechStream`** — wraps the streaming TTS endpoint so the browser can play audio as it's generated instead of waiting for the full clip. Currently `useSpeech` is one-shot.
- **Cookbook recipes** — push-to-talk, voice agent loop, browser → mic → live captions overlay, etc.

## Links

- [Smallest AI](https://smallest.ai)
- [API Docs](https://docs.smallest.ai/waves)
- [Vercel AI SDK Integration Guide](https://docs.smallest.ai/v4.0.0/content/integrations/vercel-ai-sdk)
- [Get API Key](https://waves.smallest.ai)
- [Vercel AI SDK](https://ai-sdk.dev)
- [Runnable examples](./examples)

## License

Apache-2.0

# Next.js stream-proxy example

A complete Next.js app skeleton that wires every SDK feature into the right server/client boundary:

- **TTS proxy** — `app/api/speak/route.ts` calls `generateSpeech`, returns audio bytes. Browser uses `useSpeech()`.
- **Streaming STT proxy** — `app/api/transcribe-stream/route.ts` wraps `smallestai.transcriptionStream(...)` in `createTranscriptionStreamSSEResponse(...)`. Browser uses `useTranscriptionStream()` which decodes the SSE.
- **Voice cloning proxy** — `app/api/voice-clone/route.ts` (POST + GET) and `app/api/voice-clone/delete/route.ts` mirror calls onto `smallestai.voiceClone.{create, list, delete}`. Browser uses `useVoiceClone()`.
- **Client component** — `app/page-components/RecorderClient.tsx` shows the three hooks in action.

## Files

```
app/api/transcribe-stream/route.ts
app/api/speak/route.ts
app/api/voice-clone/route.ts
app/api/voice-clone/delete/route.ts
app/page-components/RecorderClient.tsx
next.config.mjs
```

## One-time setup

```bash
npm install smallestai-vercel-provider ai react react-dom next bufferutil utf-8-validate
```

`bufferutil` and `utf-8-validate` are required because Next.js's webpack tries to bundle `ws` and breaks its optional native bindings. The included `next.config.mjs` also marks `ws` and the SDK as `serverExternalPackages` so Next loads them via `require()` at runtime instead of bundling them.

```js
// next.config.mjs (also in this directory)
export default {
  serverExternalPackages: ['smallestai-vercel-provider', 'ws'],
};
```

## Running

```bash
export SMALLEST_API_KEY="your_key_here"
next dev -p 3000
```

Open http://localhost:3000 and try each hook from the client component.

# Examples

Runnable scripts that exercise every public surface of `smallestai-vercel-provider`. Each one is self-contained — `node examples/<file>.mjs` from the package root.

## Setup (once)

```bash
export SMALLEST_API_KEY="your_key_here"
npm install
npm run build  # examples import from ../dist/
```

## What's here

| File | What it shows |
|---|---|
| [`01-tts-basic.mjs`](./01-tts-basic.mjs) | TTS lightning-v3.1 (default), saves WAV to `/tmp/example-tts.wav` |
| [`02-tts-options.mjs`](./02-tts-options.mjs) | TTS with `similarity` / `enhancement` / `addWavHeader` / `pronunciationDicts`, `mulaw`-as-alias for `ulaw` |
| [`03-stt-batch.mjs`](./03-stt-batch.mjs) | Batch STT with `redactPii`, `redactPci`, `numerals`, `keywords`, `diarize`, `emotionDetection` |
| [`04-stt-streaming.mjs`](./04-stt-streaming.mjs) | Streaming WS STT — incremental partials + finals, accumulating transcript client-side |
| [`05-stt-streaming-oneshot.mjs`](./05-stt-streaming-oneshot.mjs) | One-shot helper for pre-recorded audio via streaming |
| [`06-voice-clone.mjs`](./06-voice-clone.mjs) | Voice clone create → list → use in TTS → delete (full lifecycle) |
| [`07-stt-streaming-autoreconnect.mjs`](./07-stt-streaming-autoreconnect.mjs) | Long-form streaming with `autoReconnect: true` and `{ type: 'reconnected' }` consumer-side handling |
| [`08-nextjs-stream-proxy/`](./08-nextjs-stream-proxy) | Full Next.js skeleton — TTS proxy, SSE streaming proxy, voice-cloning proxy, plus a client component using all three React hooks |

## Notes

- **Streaming examples (04, 05, 07) need raw PCM** (linear16, 16 kHz mono). Convert any wav with ffmpeg:
  ```bash
  ffmpeg -i input.wav -f s16le -acodec pcm_s16le -ac 1 -ar 16000 /tmp/example.s16le
  ```
- **Voice-clone example creates real clones** in your org and deletes them at the end. If a script aborts mid-run, list & delete via `smallestai.voiceClone.list()` / `delete()`.
- **Next.js skeleton (08)** is read-only sample code, not runnable from this repo's root — copy the directory into a fresh `next` app and follow its README.

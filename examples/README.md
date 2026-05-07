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
| `01-tts-basic.mjs` | TTS lightning-v3.1, save WAV to `/tmp/example-tts.wav` |
| `02-tts-options.mjs` | TTS with similarity/enhancement/pronunciationDicts/output formats |
| `03-stt-batch.mjs` | Batch STT (HTTP POST) with `redactPii`, `numerals`, `keywords`, `diarize`, etc. |
| `04-stt-streaming.mjs` | Streaming WS STT — incremental partials + finals, accumulating `fullTranscript` client-side |
| `05-stt-streaming-oneshot.mjs` | One-shot helper for pre-recorded audio via streaming |
| `06-voice-clone.mjs` | Voice clone create → list → use in TTS → delete (full lifecycle) |
| `07-nextjs-stream-proxy/` | Next.js api route that proxies streaming STT to the browser via SSE |

## Notes

- Streaming examples need raw PCM (linear16, 16 kHz mono). Convert any wav with `ffmpeg`:
  ```bash
  ffmpeg -i input.wav -f s16le -acodec pcm_s16le -ac 1 -ar 16000 output.s16le
  ```
- Voice clone examples create real clones in your org and delete them at the end. If a script aborts mid-run, list & delete via `smallestai.voiceClone.list()` / `delete()`.

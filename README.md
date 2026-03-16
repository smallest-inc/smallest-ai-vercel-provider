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
  voice: 'diana',
  speed: 1.0,
});

// audio.uint8Array — raw audio bytes
// audio.base64 — base64-encoded audio
```

### Models

| Model ID | Description |
|---|---|
| `lightning-v2` | 100ms TTFB, 16 languages, voice cloning |
| `lightning-v3.1` | 44.1 kHz, natural expressive speech, 4 languages |

### Voices

| Voice | Gender | Accent | Best For |
|---|---|---|---|
| `diana` | Female | American | General use (default) |
| `vincent` | Male | American | Announcements, briefings |
| `advika` | Female | Indian | Hindi, code-switching |
| `vivaan` | Male | Indian | Bilingual English/Hindi |
| `camilla` | Female | Mexican/Latin | Spanish content |

80+ more voices available. See [API docs](https://waves-docs.smallest.ai).

### Provider Options

```ts
const { audio } = await generateSpeech({
  model: smallestai.speech('lightning-v2'),
  text: 'Hello!',
  voice: 'vincent',
  providerOptions: {
    smallestai: {
      sampleRate: 48000,
      consistency: 0.5,
      similarity: 0.5,
      enhancement: 1,
      outputFormat: 'mp3',
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

const { text, segments } = await generateTranscription({
  model: smallestai.transcription('pulse'),
  audio: audioBuffer,
  mediaType: 'audio/wav',
});

console.log(text);
```

### Provider Options

```ts
const result = await generateTranscription({
  model: smallestai.transcription('pulse'),
  audio: audioBuffer,
  mediaType: 'audio/wav',
  providerOptions: {
    smallestai: {
      language: 'hi',
      diarize: true,
      emotionDetection: true,
    },
  },
});
```

## Links

- [Smallest AI](https://smallest.ai)
- [API Docs](https://waves-docs.smallest.ai)
- [Get API Key](https://waves.smallest.ai)
- [Vercel AI SDK](https://ai-sdk.dev)

## License

Apache-2.0

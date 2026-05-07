'use client';

import {
  useSpeech,
  useTranscriptionStream,
  useVoiceClone,
} from 'smallestai-vercel-provider/react';
import { useState } from 'react';

/**
 * Demo client component exercising all three hooks. Drop this into
 * `app/page.tsx` or any client page:
 *
 *   import { RecorderClient } from './page-components/RecorderClient';
 *   export default function Page() { return <RecorderClient />; }
 */
export function RecorderClient() {
  // ── TTS ──────────────────────────────────────────────────────────
  const speech = useSpeech({ apiPath: '/api/speak' });
  const [text, setText] = useState('Hello from the Smallest AI SDK.');

  // ── Streaming STT ────────────────────────────────────────────────
  const stt = useTranscriptionStream({ apiPath: '/api/transcribe-stream' });

  const onTranscribe = async (file: File) => {
    // Convert any audio to raw PCM s16le @ 16k mono on your server,
    // OR ask users to upload pre-converted audio. For demo, we POST
    // the file as-is and let the server handle the WS framing.
    const buf = new Uint8Array(await file.arrayBuffer());
    await stt.transcribe(buf);
  };

  // ── Voice cloning ────────────────────────────────────────────────
  const vc = useVoiceClone({ apiPath: '/api/voice-clone' });
  const [cloneName, setCloneName] = useState('My voice');

  const onCreateClone = async (file: File) => {
    await vc.create({
      file,
      displayName: cloneName,
      language: 'en',
      model: 'lightning-v3.1',
    });
  };

  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>Smallest AI · Vercel SDK demo</h1>

      {/* TTS */}
      <section style={{ marginBlock: 32 }}>
        <h2>Text → Speech</h2>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          style={{ width: '100%' }}
        />
        <button
          onClick={() => speech.generate({ text, voice: 'sophia' })}
          disabled={speech.isLoading || !text.trim()}
        >
          {speech.isLoading ? 'Generating…' : 'Generate'}
        </button>
        {speech.error && <p style={{ color: 'crimson' }}>{speech.error.message}</p>}
        {speech.audioUrl && <audio controls src={speech.audioUrl} style={{ display: 'block', marginTop: 8 }} />}
      </section>

      {/* Streaming STT */}
      <section style={{ marginBlock: 32 }}>
        <h2>Speech → Text (streaming)</h2>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => e.target.files?.[0] && onTranscribe(e.target.files[0])}
        />
        {stt.isStreaming && (
          <button onClick={stt.cancel} style={{ marginInline: 8 }}>
            Cancel
          </button>
        )}
        <p>
          <strong>Final:</strong> {stt.transcript || <em>(empty)</em>}
        </p>
        {stt.partial && (
          <p style={{ opacity: 0.6 }}>
            <strong>Partial:</strong> {stt.partial}
          </p>
        )}
        {stt.error && <p style={{ color: 'crimson' }}>{stt.error.message}</p>}
      </section>

      {/* Voice cloning */}
      <section style={{ marginBlock: 32 }}>
        <h2>Voice Cloning</h2>
        <label>
          Display name:&nbsp;
          <input value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
        </label>
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => e.target.files?.[0] && onCreateClone(e.target.files[0])}
          style={{ marginInlineStart: 8 }}
        />
        <ul>
          {vc.clones.map((c) => (
            <li key={c.voiceId}>
              <code>{c.voiceId}</code> — {c.displayName}{' '}
              <button onClick={() => vc.remove(c.voiceId)} disabled={vc.isLoading}>
                Delete
              </button>
            </li>
          ))}
        </ul>
        {vc.error && <p style={{ color: 'crimson' }}>{vc.error.message}</p>}
      </section>
    </main>
  );
}

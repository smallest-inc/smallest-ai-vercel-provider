import { useCallback, useRef, useState } from 'react';
import {
  parseTranscriptionStreamSSE,
  type SmallestAITranscriptionStreamMessage,
} from '../index';

/**
 * Browser-side streaming STT hook. Talks to a same-origin SSE endpoint
 * that wraps `smallestai.transcriptionStream(...)` server-side using
 * `createTranscriptionStreamSSEResponse()`.
 *
 * This hook never sees the API key, never opens a raw WebSocket, and
 * works in any modern browser.
 *
 * The hook accumulates the running transcript from `is_final: true`
 * frames (the canonical pattern — server-side `full_transcript` is
 * empty today). All raw frames are also exposed via `messages`.
 */
export interface UseTranscriptionStreamOptions {
  /** SSE endpoint. Default `/api/transcribe-stream`. */
  apiPath?: string;
  /** Extra fetch headers. */
  headers?: HeadersInit;
}

export interface UseTranscriptionStreamResult {
  /** Accumulated transcript from `is_final: true` frames. */
  transcript: string;
  /** Latest partial (`is_final: false`) transcript, if any. */
  partial: string;
  /** Every server frame (and synthetic `reconnected` frames). */
  messages: SmallestAITranscriptionStreamMessage[];
  isStreaming: boolean;
  error: Error | null;
  /**
   * Send the audio buffer to the server route, which streams it via
   * WebSocket to Smallest AI and proxies the responses back as SSE.
   * Returns when the server closes the stream (after `is_last: true`).
   */
  transcribe: (audio: Uint8Array | Blob | ArrayBuffer) => Promise<string>;
  /** Abort the current stream, if any. */
  cancel: () => void;
  /** Clear all state (transcript, partial, messages, error). */
  reset: () => void;
}

export function useTranscriptionStream(
  opts: UseTranscriptionStreamOptions = {},
): UseTranscriptionStreamResult {
  const apiPath = opts.apiPath ?? '/api/transcribe-stream';
  const [transcript, setTranscript] = useState('');
  const [partial, setPartial] = useState('');
  const [messages, setMessages] = useState<SmallestAITranscriptionStreamMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setTranscript('');
    setPartial('');
    setMessages([]);
    setError(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    // Clear the in-flight partial so the UI doesn't show a stale
    // "..." after the user explicitly cancels.
    setPartial('');
  }, []);

  const transcribe = useCallback<UseTranscriptionStreamResult['transcribe']>(
    async (audio) => {
      cancel();
      reset();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setIsStreaming(true);
      try {
        const body =
          audio instanceof Uint8Array
            ? (audio as unknown as BodyInit)
            : audio instanceof Blob
              ? audio
              : new Uint8Array(audio as ArrayBuffer);
        const res = await fetch(apiPath, {
          method: 'POST',
          headers: { ...(opts.headers ?? {}) },
          body: body as BodyInit,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Stream request failed (HTTP ${res.status}): ${text}`);
        }

        let final = '';
        for await (const msg of parseTranscriptionStreamSSE(res)) {
          setMessages((prev) => [...prev, msg]);
          if (msg.type === 'error') {
            throw new Error(msg.message ?? msg.error ?? 'Server error');
          }
          if (msg.is_final && msg.transcript) {
            final += (final ? ' ' : '') + msg.transcript;
            setTranscript(final);
            setPartial('');
          } else if (msg.transcript) {
            setPartial(msg.transcript);
          }
          if (msg.is_last) break;
        }
        return final;
      } catch (err) {
        if ((err as any)?.name === 'AbortError') return transcript;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [apiPath, cancel, opts.headers, reset, transcript],
  );

  return { transcript, partial, messages, isStreaming, error, transcribe, cancel, reset };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  parseTranscriptionStreamSSE,
  type SmallestAITranscriptionStreamMessage,
} from '../index';
import { useMicrophonePCM } from './use-microphone-pcm';

/**
 * High-level browser hook: capture mic, push raw PCM to a streaming
 * proxy endpoint, expose live transcript state.
 *
 * Connection model: opens a single long-lived `fetch` to your
 * `apiPath` and sends mic chunks as the request body via a
 * `ReadableStream`. Server forwards each chunk into
 * `smallestai.transcriptionStream(...).sendAudio()` and pipes the WS
 * frames back as Server-Sent Events. The hook parses the SSE response
 * and accumulates the transcript exactly like
 * `useTranscriptionStream` does for one-shot uploads.
 *
 * Wire it up server-side with the lower-level
 * `createTranscriptionStreamSSEResponse()` helper plus a small adapter
 * that pumps `req.body` chunks into the stream.
 */
export interface UseMicrophoneTranscriptionOptions {
  /** SSE endpoint that accepts streaming audio. Default `/api/transcribe-mic-stream`. */
  apiPath?: string;
  /** Capture sample rate. Should match your server-side `sampleRate`. Default 16000. */
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;
  /** Audio frame size before flush (ms). Default 100. */
  batchMs?: number;
  /** Backpressure cap on queued mic chunks. Default 50. */
  maxQueuedChunks?: number;
  /** Extra fetch headers. */
  headers?: HeadersInit;
}

export interface UseMicrophoneTranscriptionResult {
  /** Accumulated transcript from `is_final` frames. */
  transcript: string;
  /** Latest in-progress utterance, if any. */
  partial: string;
  /** Every server frame (and synthetic `reconnected` frames). */
  messages: SmallestAITranscriptionStreamMessage[];
  isCapturing: boolean;
  isStreaming: boolean;
  error: Error | null;
  chunksDelivered: number;
  chunksDropped: number;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => void;
}

export function useMicrophoneTranscription(
  opts: UseMicrophoneTranscriptionOptions = {},
): UseMicrophoneTranscriptionResult {
  const apiPath = opts.apiPath ?? '/api/transcribe-mic-stream';

  const [transcript, setTranscript] = useState('');
  const [partial, setPartial] = useState('');
  const [messages, setMessages] = useState<SmallestAITranscriptionStreamMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Outgoing audio pipe: a ReadableStream<Uint8Array> the fetch body
  // consumes. The mic hook's `onChunk` enqueues into the controller.
  const controllerRef = useRef<ReadableStreamDefaultController<Uint8Array> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setTranscript('');
    setPartial('');
    setMessages([]);
    setError(null);
  }, []);

  const mic = useMicrophonePCM({
    sampleRate: opts.sampleRate,
    batchMs: opts.batchMs,
    maxQueuedChunks: opts.maxQueuedChunks ?? 50,
    onChunk: (chunk) => {
      // Even if backpressure is exceeded the chunk has already been
      // dropped from the queue — `onChunk` is called regardless so the
      // consumer sees the latest frame. We just enqueue into the body
      // stream when one is open.
      try {
        controllerRef.current?.enqueue(chunk);
      } catch {
        // Stream may have been closed already; ignore.
      }
    },
  });

  const stop = useCallback(async () => {
    mic.stop();
    try {
      controllerRef.current?.close();
    } catch {
      // already closed
    }
    controllerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, [mic]);

  const start = useCallback<UseMicrophoneTranscriptionResult['start']>(async () => {
    if (isStreaming) return;
    reset();

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);

    // Build the mic-side body stream BEFORE starting capture so the
    // first chunk lands in the right place.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef.current = controller;
      },
      cancel() {
        // Body cancelled (request aborted) — stop capture.
        mic.stop();
      },
    });

    let response: Response;
    try {
      // `duplex: 'half'` is required by spec for streaming request
      // bodies. Chrome/Edge support it via Origin Trial flags or in
      // recent versions; behind-the-scenes, Next.js's Node runtime
      // accepts the stream natively.
      response = await fetch(apiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(opts.headers ?? {}),
        },
        body,
        // @ts-expect-error duplex is not in DOM lib types but is a
        // valid fetch option for streaming request bodies.
        duplex: 'half',
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setIsStreaming(false);
      throw e;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const e = new Error(`mic stream request failed (HTTP ${response.status}): ${text}`);
      setError(e);
      setIsStreaming(false);
      throw e;
    }

    // Capture starts AFTER the fetch resolves so we don't enqueue mic
    // chunks before the server is ready.
    try {
      await mic.start();
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setIsStreaming(false);
      try {
        controllerRef.current?.close();
      } catch {
        /* */
      }
      throw e;
    }

    // Drain SSE in the background; let the consumer proceed.
    void (async () => {
      try {
        for await (const msg of parseTranscriptionStreamSSE(response)) {
          setMessages((prev) => [...prev, msg]);
          if (msg.type === 'error') {
            throw new Error(msg.message ?? msg.error ?? 'Server error');
          }
          if (msg.is_final && msg.transcript) {
            setTranscript((prev) => (prev ? prev + ' ' : '') + msg.transcript!);
            setPartial('');
          } else if (msg.transcript) {
            setPartial(msg.transcript);
          }
          if (msg.is_last) break;
        }
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
        }
      } finally {
        await stop();
      }
    })();
  }, [apiPath, isStreaming, mic, opts.headers, reset, stop]);

  // Best-effort cleanup if the component unmounts mid-stream.
  useEffect(() => {
    return () => {
      void stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    transcript,
    partial,
    messages,
    isCapturing: mic.isCapturing,
    isStreaming,
    error,
    chunksDelivered: mic.chunksDelivered,
    chunksDropped: mic.chunksDropped,
    start,
    stop,
    reset,
  };
}

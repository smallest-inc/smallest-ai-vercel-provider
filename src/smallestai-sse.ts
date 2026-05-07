import type {
  SmallestAITranscriptionStream,
  SmallestAITranscriptionStreamMessage,
} from './smallestai-transcription-stream';

/**
 * Wrap a connected `SmallestAITranscriptionStream` in a `Response` whose
 * body is a Server-Sent Events stream of every server message. Drop-in
 * for any framework that returns a standard `Response` (Next.js App
 * Router, Hono, Bun, etc.).
 *
 * Each iteration is sent as `data: ${JSON.stringify(msg)}\n\n` so the
 * browser can consume it with `EventSource` or a `fetch` +
 * `ReadableStream` reader. Stops when the iterator yields `is_last:
 * true` or the consumer aborts.
 *
 * @example
 * ```ts
 * // app/api/transcribe-stream/route.ts (Next.js, Node runtime)
 * import {
 *   smallestai,
 *   createTranscriptionStreamSSEResponse,
 * } from 'smallestai-vercel-provider';
 *
 * export const runtime = 'nodejs';
 *
 * export async function POST(req: Request) {
 *   const audio = new Uint8Array(await req.arrayBuffer());
 *   const stream = smallestai.transcriptionStream('pulse', {
 *     language: 'en',
 *     encoding: 'linear16',
 *     sampleRate: 16000,
 *     itnNormalize: true,
 *   });
 *   await stream.connect();
 *   for (let i = 0; i < audio.length; i += 32 * 1024) {
 *     stream.sendAudio(audio.subarray(i, i + 32 * 1024));
 *   }
 *   stream.closeStream();
 *   return createTranscriptionStreamSSEResponse(stream);
 * }
 * ```
 */
export function createTranscriptionStreamSSEResponse(
  stream: SmallestAITranscriptionStream,
  options: {
    /** Forward only `is_final: true` frames; suppress partials. */
    finalsOnly?: boolean;
    /**
     * Optional transform applied to every message before serialization.
     * Return `null` to drop the frame.
     */
    map?: (
      msg: SmallestAITranscriptionStreamMessage,
    ) => SmallestAITranscriptionStreamMessage | null;
    /**
     * Optional `AbortSignal` for early termination (e.g. client closed
     * the request). The SDK already aborts the WS via `stream.close()`
     * when the iterator's `return()` is invoked.
     */
    signal?: AbortSignal;
  } = {},
): Response {
  const encoder = new TextEncoder();

  const sse = new ReadableStream({
    async start(controller) {
      const onAbort = () => {
        try {
          stream.close();
        } catch {
          // ignore — close() is idempotent
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // Handle the case where the signal has *already* aborted by the
      // time we get here. addEventListener('abort', ...) on an
      // already-aborted signal is a no-op, so without this short-
      // circuit we'd open an upstream WS for a request that's already
      // dead.
      if (options.signal?.aborted) {
        onAbort();
        return;
      }
      options.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        for await (const msg of stream) {
          if (options.finalsOnly && msg.is_final !== true && msg.type !== 'reconnected')
            continue;
          const out = options.map ? options.map(msg) : msg;
          if (!out) continue;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(out)}\n\n`));
          if (out.is_last) break;
        }
      } catch (err: any) {
        const errFrame = {
          type: 'error',
          message: err?.message ?? String(err),
        };
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errFrame)}\n\n`),
          );
        } catch {
          // ignore
        }
      } finally {
        options.signal?.removeEventListener('abort', onAbort);
        controller.close();
      }
    },
    cancel() {
      // Browser disconnected mid-stream — close upstream WS.
      try {
        stream.close();
      } catch {
        // ignore
      }
    },
  });

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}

/**
 * Browser-side counterpart: parse an SSE response into an
 * `AsyncIterable<SmallestAITranscriptionStreamMessage>`. Use this in
 * `useTranscriptionStream()` and any browser code that consumes a
 * `createTranscriptionStreamSSEResponse()` endpoint.
 */
export async function* parseTranscriptionStreamSSE(
  response: Response,
): AsyncGenerator<SmallestAITranscriptionStreamMessage> {
  if (!response.body) throw new Error('SSE response has no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse complete `data: ...\n\n` events.
      let split: number;
      while ((split = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        const dataLines = event
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart());
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');
        try {
          const msg = JSON.parse(dataStr) as SmallestAITranscriptionStreamMessage;
          yield msg;
          if (msg.is_last) return;
        } catch {
          // ignore malformed frames
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

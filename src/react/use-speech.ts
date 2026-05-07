import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One-shot TTS hook — calls a server route that returns audio bytes
 * (typically using `experimental_generateSpeech` + the smallestai
 * provider). The hook does not call the smallestai package directly,
 * so the API key never reaches the browser.
 *
 * Default `apiPath` is `/api/speak` and the server is expected to:
 *   - Accept `POST` with JSON body `{ text, voice?, ...providerOptions }`.
 *   - Return the audio as the response body (e.g. `audio/mpeg` or `audio/wav`).
 *
 * Returns:
 *   - `audioUrl`: object URL playable via `<audio src={audioUrl} />`.
 *   - `isLoading` / `error`.
 *   - `generate(input)`: triggers the call. Aborts any in-flight request.
 *   - `reset()`: clears state and revokes the object URL.
 */
export interface UseSpeechOptions {
  apiPath?: string;
  /** Extra fetch headers (e.g. CSRF, auth). */
  headers?: HeadersInit;
}

export interface UseSpeechResult {
  audioUrl: string | null;
  isLoading: boolean;
  error: Error | null;
  generate: (input: {
    text: string;
    voice?: string;
    [key: string]: unknown;
  }) => Promise<Blob>;
  reset: () => void;
}

export function useSpeech(opts: UseSpeechOptions = {}): UseSpeechResult {
  const apiPath = opts.apiPath ?? '/api/speak';
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setAudioUrl(null);
    setError(null);
  }, []);

  const generate = useCallback<UseSpeechResult['generate']>(
    async (input) => {
      // Cancel any in-flight request.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(apiPath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
          body: JSON.stringify(input),
          signal: ctrl.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`TTS request failed (HTTP ${res.status}): ${text}`);
        }
        const blob = await res.blob();
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setAudioUrl(url);
        return blob;
      } catch (err) {
        if ((err as any)?.name === 'AbortError') throw err;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setIsLoading(false);
      }
    },
    [apiPath, opts.headers],
  );

  // Revoke any outstanding object URL on unmount so we don't leak Blob
  // backing storage when a user navigates away mid-playback.
  useEffect(() => {
    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      abortRef.current?.abort();
    };
  }, []);

  return { audioUrl, isLoading, error, generate, reset };
}

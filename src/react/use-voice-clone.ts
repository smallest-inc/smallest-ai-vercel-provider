import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceCloneRecord } from '../smallestai-voice-clone';

/**
 * Voice-cloning hook. Like the speech and transcription hooks, this
 * never calls the smallestai package directly — it talks to two
 * server-side routes you wire up:
 *
 *   - `POST <apiPath>`: multipart/form-data create. Body fields: `file`,
 *     `displayName`, `description?`, `accent?`, `tags?`, `language?`,
 *     `model?`. Returns the new `VoiceCloneRecord`.
 *   - `GET  <apiPath>`: returns `{ data: VoiceCloneRecord[] }`.
 *   - `POST <apiPath>/delete` with body `{ voiceId }`.
 *
 * On the server, mirror the calls onto `smallestai.voiceClone.create`,
 * `.list`, `.delete` from the package.
 */
export interface UseVoiceCloneOptions {
  /** API path. Default `/api/voice-clone`. */
  apiPath?: string;
  /** Auto-load existing clones on mount. Default true. */
  autoLoad?: boolean;
  /** Extra fetch headers. */
  headers?: HeadersInit;
}

export interface UseVoiceCloneResult {
  clones: VoiceCloneRecord[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  create: (input: {
    file: Blob | File;
    displayName: string;
    description?: string;
    accent?: string;
    tags?: string[];
    language?: string;
    model?: string;
  }) => Promise<VoiceCloneRecord>;
  remove: (voiceId: string) => Promise<void>;
}

export function useVoiceClone(opts: UseVoiceCloneOptions = {}): UseVoiceCloneResult {
  const apiPath = opts.apiPath ?? '/api/voice-clone';
  const autoLoad = opts.autoLoad ?? true;
  const [clones, setClones] = useState<VoiceCloneRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const headersRef = useRef(opts.headers);
  headersRef.current = opts.headers;

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPath, {
        headers: headersRef.current,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`list failed (HTTP ${res.status}): ${text}`);
      }
      const json = (await res.json()) as { data?: VoiceCloneRecord[] };
      setClones(json.data ?? []);
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    } finally {
      setIsLoading(false);
    }
  }, [apiPath]);

  const create = useCallback<UseVoiceCloneResult['create']>(
    async (input) => {
      setIsLoading(true);
      setError(null);
      try {
        const form = new FormData();
        form.set(
          'file',
          input.file,
          (input.file as File).name ?? 'voice.wav',
        );
        form.set('displayName', input.displayName);
        if (input.description) form.set('description', input.description);
        if (input.accent) form.set('accent', input.accent);
        if (input.tags && input.tags.length) form.set('tags', input.tags.join(','));
        if (input.language) form.set('language', input.language);
        if (input.model) form.set('model', input.model);

        const res = await fetch(apiPath, {
          method: 'POST',
          headers: headersRef.current,
          body: form,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`create failed (HTTP ${res.status}): ${text}`);
        }
        const json = (await res.json()) as { data: VoiceCloneRecord };
        const record = json.data;
        setClones((prev) => [record, ...prev]);
        return record;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [apiPath],
  );

  const remove = useCallback<UseVoiceCloneResult['remove']>(
    async (voiceId) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiPath}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(headersRef.current ?? {}) },
          body: JSON.stringify({ voiceId }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`delete failed (HTTP ${res.status}): ${text}`);
        }
        setClones((prev) => prev.filter((c) => c.voiceId !== voiceId));
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        throw e;
      } finally {
        setIsLoading(false);
      }
    },
    [apiPath],
  );

  useEffect(() => {
    if (autoLoad) {
      refresh().catch(() => {
        // error already set in state
      });
    }
  }, [autoLoad, refresh]);

  return { clones, isLoading, error, refresh, create, remove };
}

import { z } from 'zod';
import type { SmallestAIConfig } from './smallestai-config';
import type { LightningV31Language } from './smallestai-speech-options';

export interface VoiceCloneCreateOptions {
  /** Audio file bytes (wav/mp3/webm/mp4). */
  file: Uint8Array | ArrayBuffer | Blob;
  /** File name including extension. Used to derive the MIME type. */
  fileName: string;
  /** Optional MIME type override (otherwise inferred from `fileName`). */
  mimeType?: string;
  /** Voice display name (1–500 chars). */
  displayName: string;
  /** Free-form description. */
  description?: string;
  /** Accent label, e.g. `'general american'`. */
  accent?: string;
  /** Tags. Sent as a comma-joined string per the server schema. */
  tags?: string[];
  /** ISO 639-1 language code from the lightning-v3.1 supported list. */
  language?: LightningV31Language;
  /** Defaults to `'lightning-v3.1'` server-side. `'lightning-v2'` is rejected. */
  model?: string;
  /** Override request headers. */
  headers?: Record<string, string>;
  /** Abort signal. */
  abortSignal?: AbortSignal;
}

export interface VoiceCloneRecord {
  _id?: string;
  voiceId: string;
  displayName: string;
  description?: string;
  accent?: string;
  tags?: string[];
  status: 'pending' | 'processing' | 'completed' | string;
  cloningType?: 'instant' | 'professional' | string;
  language?: string;
  modelIds?: string[];
  createdAt?: string;
  updatedAt?: string;
  samples?: Array<{ url?: string; text?: string }>;
}

const recordSchema = z
  .object({
    _id: z.string().optional(),
    voiceId: z.string(),
    displayName: z.string(),
    description: z.string().optional(),
    accent: z.string().optional(),
    tags: z.array(z.string()).optional(),
    status: z.string(),
    cloningType: z.string().optional(),
    language: z.string().optional(),
    modelIds: z.array(z.string()).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    samples: z
      .array(z.object({ url: z.string().optional(), text: z.string().optional() }))
      .optional(),
  })
  .passthrough();

const listResponseSchema = z.object({
  data: z.array(recordSchema),
});

const createResponseSchema = z.object({
  data: recordSchema,
});

const getResponseSchema = z.object({
  success: z.boolean().optional(),
  data: recordSchema,
});

const deleteResponseSchema = z.object({
  success: z.boolean(),
  voiceId: z.string().optional(),
  organizationId: z.string().optional(),
});

const MIME_BY_EXT: Record<string, string> = {
  wav: 'audio/wav',
  wave: 'audio/wav',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  webm: 'audio/webm',
};

function inferMimeType(fileName: string, override?: string): string {
  if (override) return override;
  const ext = fileName.split('.').pop()?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || 'application/octet-stream';
}

function toBlob(
  file: Uint8Array | ArrayBuffer | Blob,
  mimeType: string,
): Blob {
  if (file instanceof Blob) return file;
  // Cast through `BlobPart` — Uint8Array<SharedArrayBuffer> isn't assignable
  // to BlobPart in newer @types/node, but it works at runtime.
  return new Blob([file as unknown as BlobPart], { type: mimeType });
}

export class SmallestAIVoiceCloneClient {
  constructor(private readonly config: SmallestAIConfig) {}

  /**
   * Create an instant voice clone from a reference audio sample.
   * Returns the record including the new `voiceId` you pass to TTS as `voice`.
   */
  async create(options: VoiceCloneCreateOptions): Promise<VoiceCloneRecord> {
    const mimeType = inferMimeType(options.fileName, options.mimeType);
    const blob = toBlob(options.file, mimeType);

    const form = new FormData();
    form.set('file', blob, options.fileName);
    form.set('displayName', options.displayName);
    if (options.description) form.set('description', options.description);
    if (options.accent) form.set('accent', options.accent);
    if (options.tags && options.tags.length > 0)
      form.set('tags', options.tags.join(','));
    if (options.language) form.set('language', options.language);
    if (options.model) form.set('model', options.model);

    // Build headers WITHOUT Content-Type so fetch sets the multipart boundary.
    const baseHeaders = this.config.headers();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseHeaders)) {
      if (v && k.toLowerCase() !== 'content-type') headers[k] = v;
    }
    if (options.headers) {
      for (const [k, v] of Object.entries(options.headers)) {
        if (k.toLowerCase() !== 'content-type') headers[k] = v;
      }
    }

    const url = this.config.url({
      path: '/waves/v1/voice-cloning/',
      modelId: 'voice-clone',
    });
    const fetchFn = this.config.fetch ?? fetch;

    const response = await fetchFn(url, {
      method: 'POST',
      headers,
      body: form,
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Smallest AI voice-clone create failed (HTTP ${response.status}): ${text}`,
      );
    }
    const json = await response.json();
    return createResponseSchema.parse(json).data;
  }

  /** List every completed/processing clone for the authenticated organization. */
  async list(opts?: {
    headers?: Record<string, string>;
    abortSignal?: AbortSignal;
  }): Promise<VoiceCloneRecord[]> {
    const url = this.config.url({
      path: '/waves/v1/voice-cloning/',
      modelId: 'voice-clone',
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.config.headers())) {
      if (v) headers[k] = v;
    }
    if (opts?.headers) Object.assign(headers, opts.headers);

    const fetchFn = this.config.fetch ?? fetch;
    const response = await fetchFn(url, {
      method: 'GET',
      headers,
      signal: opts?.abortSignal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Smallest AI voice-clone list failed (HTTP ${response.status}): ${text}`,
      );
    }
    const json = await response.json();
    return listResponseSchema.parse(json).data;
  }

  /** Fetch a single voice clone by Mongo `_id`. */
  async get(
    id: string,
    opts?: { headers?: Record<string, string>; abortSignal?: AbortSignal },
  ): Promise<VoiceCloneRecord> {
    const url = this.config.url({
      path: `/waves/v1/voice-cloning/${encodeURIComponent(id)}`,
      modelId: 'voice-clone',
    });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.config.headers())) {
      if (v) headers[k] = v;
    }
    if (opts?.headers) Object.assign(headers, opts.headers);

    const fetchFn = this.config.fetch ?? fetch;
    const response = await fetchFn(url, {
      method: 'GET',
      headers,
      signal: opts?.abortSignal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Smallest AI voice-clone get failed (HTTP ${response.status}): ${text}`,
      );
    }
    const json = await response.json();
    return getResponseSchema.parse(json).data;
  }

  /**
   * Delete a voice clone by `voiceId`.
   *
   * Routed to `DELETE /waves/v1/lightning-large/` because that's the
   * endpoint that accepts Bearer API key auth. The newer
   * `POST /waves/v1/voice-cloning/delete` requires a console JWT today;
   * once the server unifies auth, the SDK can repoint without a
   * caller-visible change.
   */
  async delete(
    voiceId: string,
    opts?: { headers?: Record<string, string>; abortSignal?: AbortSignal },
  ): Promise<{ success: boolean; voiceId?: string }> {
    const url = this.config.url({
      path: '/waves/v1/lightning-large/',
      modelId: 'voice-clone',
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    for (const [k, v] of Object.entries(this.config.headers())) {
      if (v) headers[k] = v;
    }
    if (opts?.headers) Object.assign(headers, opts.headers);

    const fetchFn = this.config.fetch ?? fetch;
    const response = await fetchFn(url, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ voiceId }),
      signal: opts?.abortSignal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Smallest AI voice-clone delete failed (HTTP ${response.status}): ${text}`,
      );
    }
    const json = await response.json();
    return deleteResponseSchema.parse(json);
  }
}

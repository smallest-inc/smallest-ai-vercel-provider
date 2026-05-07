import { z } from 'zod';
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { VERSION } from './version';
import type { SmallestAITranscriptionModelId } from './smallestai-transcription-options';

// `ws` is lazy-loaded inside defaultWebSocketFactory() — see the
// comment there. Bundling it at module scope would pull in Node-only
// fs/net/tls/etc. into every browser bundle even when consumers use
// `auth: 'query'` or `signedUrl` (which need only native WebSocket).
type WSCtor = new (
  url: string,
  opts?: { headers?: Record<string, string> },
) => unknown;
let cachedWsCtor: WSCtor | null = null;
async function loadWsCtor(): Promise<WSCtor> {
  if (cachedWsCtor) return cachedWsCtor;
  // Dynamic import keeps the static dependency graph clean — bundlers
  // that tree-shake (Webpack, Rollup, esbuild, Vite, Next) won't drag
  // ws into the browser bundle if no code path reaches this function.
  const mod = await import('ws');
  cachedWsCtor = (mod.default ?? mod) as unknown as WSCtor;
  return cachedWsCtor;
}

/**
 * Options for `smallestai.transcriptionStream(modelId, opts)`.
 * Mirrors the WS query parameters accepted by waves-platform at
 * `/waves/v1/pulse/get_text` (see `pulse.asr.schema.ts`).
 */
export interface SmallestAITranscriptionStreamOptions {
  // ── Audio configuration ─────────────────────────────────────────────
  /** Audio encoding. Default `linear16`. */
  encoding?: 'linear16' | 'linear32' | 'alaw' | 'mulaw' | 'opus' | 'ogg_opus';
  /** Audio sample rate in Hz. Default 16000. */
  sampleRate?: 8000 | 16000 | 22050 | 24000 | 44100 | 48000;

  // ── Language ────────────────────────────────────────────────────────
  language?: string;

  // ── Feature flags ───────────────────────────────────────────────────
  wordTimestamps?: boolean;
  diarize?: boolean;
  redactPii?: boolean;
  redactPci?: boolean;
  numerals?: 'true' | 'false' | 'auto';
  keywords?: string[];
  punctuate?: boolean;
  capitalize?: boolean;
  emotionDetection?: boolean;
  genderDetection?: boolean;
  /** Boolean: include sentence-level timestamps (utterances) in responses. */
  sentenceTimestamps?: boolean;
  /**
   * Boolean: cumulative transcript field on `is_final: true` frames.
   * Documented at /v4.0.0/content/speech-to-text/features/full-transcript.
   * Forwarded as a query param; behavior depends on server rollout state
   * for the audio you're streaming.
   */
  fullTranscript?: boolean;
  /** Inverse text normalization (e.g. "twenty five" → "25"). */
  itnNormalize?: boolean;
  /** End-of-utterance timeout in ms (100–10000). */
  eouTimeoutMs?: number;
  /** Force finalize after this many words. */
  maxWords?: number;
  /** Default true; controls finalize-on-words behavior. */
  finalizeOnWords?: boolean;
  /** Default true; format output. */
  format?: boolean;

  // ── Reliability ─────────────────────────────────────────────────────
  /**
   * If true, reconnect transparently on unexpected socket drops
   * (network blip, server restart, idle timeout). The session will
   * re-open with the same parameters and emit a synthetic
   * `{ type: 'reconnected', attempt }` message so consumers can react.
   * Default `false` (preserves single-shot semantics).
   */
  autoReconnect?: boolean;
  /** Max reconnect attempts before giving up. Default 5. */
  maxReconnectAttempts?: number;
  /**
   * Base reconnect delay in ms; doubles per attempt up to 30s.
   * Default 500.
   */
  reconnectBackoffMs?: number;
}

/**
 * One transcription update from the server. Fields are optional because
 * the server emits multiple message shapes — partial transcripts,
 * is_final ticks, and the terminal is_last frame.
 */
export interface SmallestAITranscriptionStreamMessage {
  session_id?: string;
  transcript?: string;
  full_transcript?: string;
  is_final?: boolean;
  is_last?: boolean;
  language?: string | null;
  languages?: string[] | null;
  words?: Array<{
    word: string;
    start?: number;
    end?: number;
    confidence?: number;
    speaker?: number | string;
    speaker_confidence?: number;
  }>;
  utterances?: Array<{
    text: string;
    start?: number;
    end?: number;
    speaker?: number | string;
  }>;
  redacted_entities?: string[];
  /**
   * Server frame type (`'transcription'` for normal data) or
   * SDK-synthesized signal: `'reconnected'` after a reconnect succeeded.
   */
  type?: string;
  message?: string;
  error?: string;
  /** Reconnect attempt number (1-based). Only present on `type: 'reconnected'` SDK synthetic frames. */
  attempt?: number;
}

const messageSchema = z
  .object({
    session_id: z.string().optional(),
    transcript: z.string().optional(),
    full_transcript: z.string().optional(),
    is_final: z.boolean().optional(),
    is_last: z.boolean().optional(),
    language: z.string().nullish(),
    languages: z.array(z.string()).nullish(),
    words: z.array(z.any()).optional(),
    utterances: z.array(z.any()).optional(),
    redacted_entities: z.array(z.string()).optional(),
    type: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  })
  .passthrough();

/**
 * One-time-per-process deduplication for the `auth: 'query'` warning so
 * we don't spam the console on every connect. The user can opt out via
 * `suppressInsecureAuthWarning: true`.
 */
let queryAuthWarned = false;

function warnQueryAuthOnce() {
  if (queryAuthWarned) return;
  queryAuthWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[smallestai-vercel-provider] auth: 'query' is in use. The API key " +
      'will appear in the WebSocket URL — visible in browser devtools, ' +
      'history, and any HTTP intermediary that logs request lines. ' +
      'Acceptable for dev / internal apps with per-user-scoped keys; ' +
      "for end-user production, prefer signedUrl or the SSE proxy. " +
      'Pass `suppressInsecureAuthWarning: true` once you have audited the deployment.',
  );
}

/**
 * Validate a URL returned by the user's `signedUrl()` callback.
 * Defense-in-depth: if the user's signing endpoint has a bug (or is
 * compromised) and tries to redirect audio elsewhere, we fail loud
 * before a single byte ships. Throws on rejection.
 */
function validateSignedUrl(
  url: string,
  expectedHost: string,
  allowedHosts: string[],
): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`signedUrl() returned an invalid URL: ${String(url).slice(0, 80)}`);
  }
  // Must be wss: (or ws: only if the host is in allowedHosts and looks
  // like localhost).
  if (parsed.protocol !== 'wss:') {
    const isLocalhost =
      parsed.protocol === 'ws:' &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === '[::1]');
    const localhostAllowed = allowedHosts.some(
      (h) => h === parsed.hostname || h === 'localhost',
    );
    if (!(isLocalhost && localhostAllowed)) {
      throw new Error(
        `signedUrl() returned a non-wss URL (${parsed.protocol}). ` +
          'TLS is required for streaming audio. Allow `ws://localhost` ' +
          'only by adding "localhost" to allowedSignedHosts.',
      );
    }
  }
  // Host must match expected (or be in the explicit allowlist).
  if (parsed.host !== expectedHost && !allowedHosts.includes(parsed.hostname)) {
    throw new Error(
      `signedUrl() returned host "${parsed.host}" but baseURL host is ` +
        `"${expectedHost}". Add "${parsed.hostname}" to allowedSignedHosts ` +
        'if this is intentional.',
    );
  }
  return parsed;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** Minimal WebSocket-like type covering both browser WebSocket and `ws` clients. */
interface WSLike {
  readyState: number;
  send(data: string | ArrayBufferLike | Uint8Array | Blob): void;
  close(code?: number, reason?: string): void;
  addEventListener(event: 'open', cb: () => void): void;
  addEventListener(event: 'message', cb: (ev: { data: any }) => void): void;
  addEventListener(event: 'error', cb: (ev: any) => void): void;
  addEventListener(event: 'close', cb: (ev: { code?: number; reason?: string }) => void): void;
}

export type SmallestAITranscriptionStreamAuth =
  /**
   * Default. Sends the API key as `Authorization: Bearer ...` header
   * via the `ws` package. Node-only (browsers can't set custom
   * WebSocket headers).
   */
  | 'header'
  /**
   * Sends the API key as a `?api_key=...` query parameter and uses
   * native `WebSocket` (browser, Node 22+). Removes the Node-only
   * limitation but **the API key appears in the URL** — visible in
   * browser devtools, history, server access logs, and any error
   * reporting tool that captures URLs. Acceptable for dev / internal
   * apps; for end-user-facing production, use `signedUrl` instead.
   */
  | 'query';

export interface SmallestAITranscriptionStreamConfig {
  /**
   * Bearer API key. Defaults to `SMALLEST_API_KEY` env var. Required
   * unless `signedUrl` is provided.
   */
  apiKey?: string;
  /** Base URL. Defaults to `https://api.smallest.ai`. The SDK upgrades it to `wss://`. */
  baseURL?: string;
  /**
   * How to authenticate the WebSocket. Defaults to `'header'`.
   * See `SmallestAITranscriptionStreamAuth` for the full tradeoff.
   * Ignored when `signedUrl` is provided.
   */
  auth?: SmallestAITranscriptionStreamAuth;
  /**
   * Build the connection URL on demand. When provided, the SDK
   * delegates URL construction entirely — your server can mint a
   * short-lived signed URL and return it, so the API key never lives
   * in the browser. Called on every `connect()` (initial and reconnect)
   * so each session can have a fresh URL.
   *
   * Mutually exclusive with `apiKey` + `auth`.
   *
   * Security: the returned URL **must** start with `wss:` (the SDK
   * rejects `ws:` to prevent TLS-stripping). The host **must** match
   * the configured `baseURL` host unless you explicitly relax that
   * via `allowedSignedHosts` — defense in depth against a bug in
   * your signing endpoint redirecting audio to the wrong server.
   */
  signedUrl?: () => Promise<string>;
  /**
   * Maximum time (ms) the SDK waits on `signedUrl()` before giving up
   * with an error. Default 10000 (10 s). Hard-capped at 60 s so a
   * misbehaving signing endpoint can't hang a long-running stream
   * forever.
   */
  signedUrlTimeoutMs?: number;
  /**
   * Hosts the SDK accepts in `signedUrl()` results, in addition to the
   * configured `baseURL` host. Default empty — SDK only accepts the
   * `baseURL` host. Use sparingly and never include user-controlled
   * hosts; primarily intended for self-hosted / dual-host deployments.
   *
   * To allow `ws:` against `localhost` for local dev, include
   * `'localhost'` (any port) here.
   */
  allowedSignedHosts?: string[];
  /**
   * Suppress the one-time `auth: 'query'` security warning. Use this
   * only after you've confirmed the API key in the URL is acceptable
   * for your deployment (typically: dev, internal apps, or per-user
   * scoped keys).
   */
  suppressInsecureAuthWarning?: boolean;
  /**
   * Override the WebSocket constructor. Defaults: `ws` package for
   * `auth: 'header'` (header support), native `WebSocket` for
   * `auth: 'query'` and `signedUrl` flows.
   */
  webSocketFactory?: (url: string, headers: Record<string, string>) => WSLike;
}

/**
 * A streaming Pulse STT session. AsyncIterable: `for await` over messages.
 * Send audio chunks via `sendAudio()`; finalize with `finalize()`; close with `close()`.
 *
 * Auto-reconnect (when enabled via options) is transparent: a network
 * drop triggers backoff + reopen, and a synthetic
 * `{ type: 'reconnected', attempt }` message lands in the iterator so
 * consumers can react (e.g., show a "reconnecting…" indicator).
 */
export class SmallestAITranscriptionStream
  implements AsyncIterable<SmallestAITranscriptionStreamMessage>
{
  private ws: WSLike | null = null;
  private resolvers: Array<(v: IteratorResult<SmallestAITranscriptionStreamMessage>) => void> = [];
  private buffer: SmallestAITranscriptionStreamMessage[] = [];
  private done = false;
  private failure: Error | null = null;
  private openPromise: Promise<void> | null = null;
  private explicitClose = false;
  private receivedIsLast = false;
  private reconnectAttempts = 0;
  private cachedUrl: string | null = null;
  private cachedHeaders: Record<string, string> | null = null;

  constructor(
    private readonly modelId: SmallestAITranscriptionModelId,
    private readonly options: SmallestAITranscriptionStreamOptions,
    private readonly config: SmallestAITranscriptionStreamConfig,
  ) {}

  /**
   * Open the WebSocket and wait until it's ready to accept audio.
   * Idempotent — calling twice returns the same Promise.
   */
  connect(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = this.openSocket();
    return this.openPromise;
  }

  private async buildUrlAndHeaders(): Promise<{
    url: string;
    headers: Record<string, string>;
  }> {
    // signedUrl path: caller owns URL construction entirely. Always
    // re-fetch (each connect / reconnect gets a fresh URL — that's the
    // whole point of a signed-URL flow). Hard timeout + scheme/host
    // validation so a bug in the signing endpoint can't redirect
    // audio elsewhere.
    if (this.config.signedUrl) {
      const timeoutMs = Math.min(
        this.config.signedUrlTimeoutMs ?? 10_000,
        60_000,
      );
      const url = await withTimeout(
        this.config.signedUrl(),
        timeoutMs,
        'signedUrl()',
      );
      const baseURL =
        withoutTrailingSlash(this.config.baseURL) ?? 'https://api.smallest.ai';
      const expectedHost = new URL(baseURL).host;
      validateSignedUrl(url, expectedHost, this.config.allowedSignedHosts ?? []);
      return {
        url,
        headers: { 'User-Agent': `smallest-ai-vercel-provider/${VERSION}` },
      };
    }

    if (this.cachedUrl && this.cachedHeaders) {
      return { url: this.cachedUrl, headers: this.cachedHeaders };
    }

    const baseURL =
      withoutTrailingSlash(this.config.baseURL) ?? 'https://api.smallest.ai';
    const wsBase = baseURL.replace(/^http(s?):/i, (_m, s) => `ws${s}:`);

    const params = new URLSearchParams();
    const o = this.options;

    const apiKey = loadApiKey({
      apiKey: this.config.apiKey,
      environmentVariableName: 'SMALLEST_API_KEY',
      description: 'Smallest AI',
    });

    const auth: SmallestAITranscriptionStreamAuth = this.config.auth ?? 'header';

    // Query-mode auth: API key goes in the URL. Set BEFORE the other
    // params so it's first (and easier to grep for in logs / devtools).
    if (auth === 'query') {
      if (!this.config.suppressInsecureAuthWarning) {
        warnQueryAuthOnce();
      }
      params.set('api_key', apiKey);
    }

    if (o.language) params.set('language', o.language);
    if (o.encoding) params.set('encoding', o.encoding);
    if (o.sampleRate) params.set('sample_rate', String(o.sampleRate));
    if (o.format !== undefined) setBool(params, 'format', o.format);
    if (o.wordTimestamps !== undefined) setBool(params, 'word_timestamps', o.wordTimestamps);
    if (o.diarize !== undefined) setBool(params, 'diarize', o.diarize);
    if (o.emotionDetection !== undefined) setBool(params, 'emotion_detection', o.emotionDetection);
    if (o.genderDetection !== undefined) setBool(params, 'gender_detection', o.genderDetection);
    if (o.redactPii !== undefined) setBool(params, 'redact_pii', o.redactPii);
    if (o.redactPci !== undefined) setBool(params, 'redact_pci', o.redactPci);
    if (o.numerals) params.set('numerals', o.numerals);
    if (o.keywords && o.keywords.length > 0) params.set('keywords', o.keywords.join(','));
    if (o.punctuate !== undefined) setBool(params, 'punctuate', o.punctuate);
    if (o.capitalize !== undefined) setBool(params, 'capitalize', o.capitalize);
    if (o.sentenceTimestamps !== undefined) setBool(params, 'sentence_timestamps', o.sentenceTimestamps);
    if (o.fullTranscript !== undefined) setBool(params, 'full_transcript', o.fullTranscript);
    if (o.itnNormalize !== undefined) setBool(params, 'itn_normalize', o.itnNormalize);
    if (o.eouTimeoutMs !== undefined) params.set('eou_timeout_ms', String(o.eouTimeoutMs));
    if (o.maxWords !== undefined) params.set('max_words', String(o.maxWords));
    if (o.finalizeOnWords !== undefined) setBool(params, 'finalize_on_words', o.finalizeOnWords);

    const url = `${wsBase}/waves/v1/${this.modelId}/get_text?${params.toString()}`;

    // Headers only carry auth in 'header' mode. 'query' mode skips the
    // Authorization header so native WebSocket can be used in the
    // browser without trying (and failing) to set headers.
    const headers: Record<string, string> = {
      'User-Agent': `smallest-ai-vercel-provider/${VERSION}`,
    };
    if (auth === 'header') {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    this.cachedUrl = url;
    this.cachedHeaders = headers;
    return { url, headers };
  }

  /**
   * Internal: open (or re-open) the WebSocket. Wires up event handlers
   * including the close handler that triggers reconnect when the close
   * is unexpected (no `is_last`, no explicit close from the consumer)
   * and `autoReconnect: true` is set.
   */
  private async openSocket(): Promise<void> {
    const { url, headers } = await this.buildUrlAndHeaders();

    const factory =
      this.config.webSocketFactory ?? (await this.defaultWebSocketFactory());

    const ws = factory(url, headers);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      let opened = false;
      ws.addEventListener('open', () => {
        opened = true;
        resolve();
      });
      ws.addEventListener('error', (ev: any) => {
        const message =
          typeof ev?.message === 'string'
            ? ev.message
            : 'Smallest AI WebSocket error';
        const err = new Error(message);
        if (!opened) {
          // Initial connect failure — bubble up; reconnect logic only
          // applies after a successful first connect.
          this.fail(err);
          reject(err);
        }
        // Post-open errors land in the close handler below.
      });
      ws.addEventListener('message', (ev) => {
        let parsed: unknown;
        try {
          const data = typeof ev.data === 'string' ? ev.data : String(ev.data);
          parsed = JSON.parse(data);
        } catch {
          return; // ignore non-JSON frames
        }
        const msg = messageSchema.safeParse(parsed);
        if (!msg.success) return;
        this.push(msg.data);
        if (msg.data.type === 'error') {
          this.fail(new Error(msg.data.message ?? msg.data.error ?? 'Server error'));
        }
        if (msg.data.is_last === true) {
          this.receivedIsLast = true;
          this.finish();
        }
      });
      ws.addEventListener('close', () => {
        // Three close paths to disambiguate:
        //   1. Server emitted is_last → terminal, do not reconnect.
        //   2. Consumer called close() / closeStream() → terminal.
        //   3. Anything else (network drop, server-side timeout, 5xx
        //      after upgrade) → reconnect if enabled, else terminal.
        if (this.receivedIsLast || this.explicitClose || this.failure) {
          this.finish();
          return;
        }
        if (this.options.autoReconnect) {
          this.scheduleReconnect();
        } else {
          this.finish();
        }
      });
    });
  }

  /**
   * Pick a default WebSocket factory based on the config:
   *
   *  - 'header' (default, Node-only): use the `ws` package since native
   *    WebSocket can't set headers. Lazy-loaded.
   *  - 'query' / signedUrl: prefer global `WebSocket` (browser, Node 22+).
   *    No headers to set, so the SDK doesn't pull `ws` into browser
   *    bundles. Falls back to lazy-loaded `ws` only if the runtime has
   *    no native WebSocket (older Node).
   */
  private async defaultWebSocketFactory(): Promise<(
    url: string,
    headers: Record<string, string>,
  ) => WSLike> {
    const needsHeaders =
      !this.config.signedUrl && (this.config.auth ?? 'header') === 'header';
    if (needsHeaders) {
      const Ws = await loadWsCtor();
      return (u, h) => new Ws(u, { headers: h }) as unknown as WSLike;
    }
    if (typeof globalThis.WebSocket !== 'undefined') {
      return (u) => new globalThis.WebSocket(u) as unknown as WSLike;
    }
    const Ws = await loadWsCtor();
    return (u) => new Ws(u) as unknown as WSLike;
  }

  private scheduleReconnect(): void {
    const max = this.options.maxReconnectAttempts ?? 5;
    if (this.reconnectAttempts >= max) {
      this.fail(
        new Error(
          `Smallest AI WS reconnect gave up after ${max} attempts; consumer should retry the whole session`,
        ),
      );
      return;
    }
    this.reconnectAttempts += 1;
    const base = this.options.reconnectBackoffMs ?? 500;
    const delay = Math.min(base * 2 ** (this.reconnectAttempts - 1), 30_000);
    setTimeout(() => {
      // Race: consumer may have called close() between the close event
      // firing and this timeout. Bail out cleanly in that case.
      if (this.explicitClose || this.done) return;
      const attemptNumber = this.reconnectAttempts;
      this.openSocket().then(
        () => {
          this.push({ type: 'reconnected', attempt: attemptNumber });
          // Critical: reset the counter on a successful reconnect so
          // long-running streams don't hit `maxReconnectAttempts`
          // across unrelated network blips. Without this, a 4-hour
          // session with one drop per hour would die at the 5th drop
          // even though every previous reconnect succeeded fast.
          this.reconnectAttempts = 0;
        },
        (err) => {
          // openSocket() already calls fail() on initial-connect
          // failure; nothing more to do here. But if the underlying
          // factory threw synchronously we surface it.
          if (!this.failure) this.fail(err instanceof Error ? err : new Error(String(err)));
        },
      );
    }, delay);
  }

  /** Send a chunk of raw audio bytes (per `encoding` + `sampleRate`). */
  sendAudio(chunk: Uint8Array | ArrayBuffer): void {
    if (!this.ws) throw new Error('connect() not called or socket not open');
    if (this.ws.readyState !== 1) throw new Error('WebSocket not open');
    this.ws.send(
      chunk instanceof Uint8Array
        ? (chunk as unknown as ArrayBufferLike)
        : (chunk as ArrayBufferLike),
    );
  }

  /**
   * Flush any buffered audio and emit the terminal `is_final: true` frame
   * for the current utterance. WS stays open for more audio. Use this for
   * multi-utterance sessions (push-to-talk, conversational STT).
   */
  finalize(): void {
    if (!this.ws) return;
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'finalize' }));
    }
  }

  /**
   * End the session. Server flushes, emits the terminal `is_last: true`
   * frame, then closes the WS. Use this when audio input is done and you
   * want a one-shot terminal signal.
   */
  closeStream(): void {
    if (!this.ws) return;
    this.explicitClose = true;
    if (this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'close_stream' }));
    }
  }

  /** Close the underlying socket without waiting for a final frame. */
  close(): void {
    this.explicitClose = true;
    if (this.ws && this.ws.readyState === 1) this.ws.close();
    this.finish();
  }

  /**
   * One-shot helper for the common pre-recorded audio case: stream the
   * whole buffer with no artificial delays, request close_stream, and
   * resolve once we see `is_last`. No frames lost; the AsyncIterator
   * buffers messages internally if the consumer is slower than the
   * server.
   *
   * Returns the full concatenated `is_final` transcript plus the array
   * of every server message.
   */
  static async transcribeOnce(
    stream: SmallestAITranscriptionStream,
    audio: Uint8Array,
    options?: { chunkSize?: number },
  ): Promise<{
    transcript: string;
    fullTranscript?: string;
    messages: SmallestAITranscriptionStreamMessage[];
  }> {
    const chunkSize = options?.chunkSize ?? 32 * 1024;
    await stream.connect();

    // Push audio as fast as the WS will take it. No artificial sleeps.
    // For real-time mic streams, use sendAudio() directly.
    for (let i = 0; i < audio.length; i += chunkSize) {
      stream.sendAudio(audio.subarray(i, Math.min(i + chunkSize, audio.length)));
    }
    stream.closeStream();

    let transcript = '';
    let fullTranscript: string | undefined;
    const messages: SmallestAITranscriptionStreamMessage[] = [];
    for await (const msg of stream) {
      messages.push(msg);
      if (msg.is_final && msg.transcript) {
        transcript += (transcript ? ' ' : '') + msg.transcript;
      }
      if (msg.full_transcript) fullTranscript = msg.full_transcript;
      if (msg.is_last) break;
    }
    return { transcript, fullTranscript, messages };
  }

  // AsyncIterable plumbing
  [Symbol.asyncIterator](): AsyncIterator<SmallestAITranscriptionStreamMessage> {
    return {
      next: () => this.next(),
      return: async () => {
        this.close();
        return { done: true, value: undefined as never };
      },
    };
  }

  private next(): Promise<IteratorResult<SmallestAITranscriptionStreamMessage>> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.buffer.length > 0) {
      return Promise.resolve({ done: false, value: this.buffer.shift()! });
    }
    if (this.done) {
      return Promise.resolve({ done: true, value: undefined as never });
    }
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  private push(msg: SmallestAITranscriptionStreamMessage) {
    const r = this.resolvers.shift();
    if (r) r({ done: false, value: msg });
    else this.buffer.push(msg);
  }

  private fail(err: Error) {
    this.failure = err;
    while (this.resolvers.length) {
      this.resolvers.shift()!({ done: true, value: undefined as never });
    }
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    while (this.resolvers.length) {
      this.resolvers.shift()!({ done: true, value: undefined as never });
    }
  }
}

function setBool(p: URLSearchParams, k: string, v: boolean) {
  p.set(k, v ? 'true' : 'false');
}

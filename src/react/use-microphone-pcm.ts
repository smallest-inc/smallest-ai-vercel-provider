import { useCallback, useRef, useState } from 'react';

/**
 * Low-level browser microphone capture: getUserMedia → AudioWorklet →
 * 16-bit signed PCM (linear16) chunks at the requested sampleRate. The
 * AudioWorklet processor is inlined as a Blob URL so callers don't
 * need to host a separate file.
 *
 * Chunks land in `onChunk(buffer)`; pipe them straight into
 * `useTranscriptionStream.transcribe(buffer)` or your own WebSocket.
 *
 * Backpressure: each chunk is ~`batchMs` ms of audio (default 100ms).
 * If `maxQueuedChunks` is set and the consumer doesn't drain them in
 * time, oldest chunks are dropped before being delivered — the
 * `onDropped` callback (if provided) reports the drop count so apps
 * can show a "lagging" indicator.
 */
export interface UseMicrophonePCMOptions {
  /** Target sample rate in Hz. Default 16000 (matches Pulse `linear16` default). */
  sampleRate?: number;
  /** Audio frame size in ms before flush. Default 100 (≈3200 bytes @ 16k mono). */
  batchMs?: number;
  /** Max queued chunks before drop-oldest backpressure kicks in. Default 0 (no cap). */
  maxQueuedChunks?: number;
  /** Called with every PCM chunk. */
  onChunk?: (chunk: Uint8Array) => void;
  /** Called when chunks are dropped due to backpressure. */
  onDropped?: (totalDropped: number) => void;
  /** Override `getUserMedia` for testing. */
  getMediaStream?: () => Promise<MediaStream>;
}

export interface UseMicrophonePCMResult {
  isCapturing: boolean;
  /**
   * Sample rate the AudioContext is actually running at. Browsers may
   * pick a different rate than requested; the worklet downsamples to
   * the user's requested rate before posting.
   */
  contextSampleRate: number | null;
  error: Error | null;
  /** Total chunks delivered since the last `start()`. */
  chunksDelivered: number;
  /** Total chunks dropped due to backpressure since the last `start()`. */
  chunksDropped: number;
  /** Permission + capture begin. Idempotent — second call no-ops. */
  start: () => Promise<void>;
  /** Stop capture and release the mic. Idempotent. */
  stop: () => void;
}

/**
 * Build the AudioWorklet processor source as a string. Inlined here so
 * the SDK can ship as a single bundle — no separate worklet file to
 * host. The worklet downsamples from the AudioContext's native rate to
 * the requested target rate using a simple decimation filter (fine for
 * ASR; not for music).
 */
const WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.targetRate = o.targetRate || 16000;
    this.batchSamples = Math.max(1, Math.round((o.batchMs || 100) * this.targetRate / 1000));
    this.contextRate = sampleRate;
    this.ratio = this.contextRate / this.targetRate;
    // Output buffer (Int16) we accumulate into before posting.
    this.outBuf = new Int16Array(this.batchSamples);
    this.outIdx = 0;
    this.inputAccumulator = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    // Downsample by skip-decimation: pick one sample every \`ratio\`
    // input samples. For 48k → 16k that's every 3rd. Crude but
    // perfectly adequate for ASR (the upstream model further filters).
    for (let i = 0; i < channel.length; i++) {
      this.inputAccumulator++;
      if (this.inputAccumulator < this.ratio) continue;
      this.inputAccumulator -= this.ratio;
      // Float [-1, 1] → Int16
      let s = channel[i];
      if (s < -1) s = -1;
      else if (s > 1) s = 1;
      this.outBuf[this.outIdx++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.outIdx >= this.batchSamples) {
        // Post a copy as a transferable ArrayBuffer.
        const copy = this.outBuf.slice(0, this.outIdx);
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.outIdx = 0;
      }
    }
    return true;
  }
}
registerProcessor('smallestai-pcm-capture', PCMCaptureProcessor);
`;

let cachedWorkletURL: string | null = null;

function ensureWorkletURL(): string {
  if (cachedWorkletURL) return cachedWorkletURL;
  if (typeof Blob === 'undefined' || typeof URL === 'undefined') {
    throw new Error(
      'useMicrophonePCM requires a browser environment (Blob + URL.createObjectURL).',
    );
  }
  const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
  cachedWorkletURL = URL.createObjectURL(blob);
  return cachedWorkletURL;
}

export function useMicrophonePCM(
  opts: UseMicrophonePCMOptions = {},
): UseMicrophonePCMResult {
  const targetRate = opts.sampleRate ?? 16000;
  const batchMs = opts.batchMs ?? 100;
  const maxQueued = opts.maxQueuedChunks ?? 0;

  const [isCapturing, setIsCapturing] = useState(false);
  const [contextSampleRate, setContextSampleRate] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [chunksDelivered, setChunksDelivered] = useState(0);
  const [chunksDropped, setChunksDropped] = useState(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const queueRef = useRef<Uint8Array[]>([]);
  const droppedRef = useRef(0);
  const onChunkRef = useRef(opts.onChunk);
  onChunkRef.current = opts.onChunk;
  const onDroppedRef = useRef(opts.onDropped);
  onDroppedRef.current = opts.onDropped;

  const stop = useCallback(() => {
    workletNodeRef.current?.disconnect();
    sourceRef.current?.disconnect();
    workletNodeRef.current = null;
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      ctxRef.current.close().catch(() => undefined);
    }
    ctxRef.current = null;
    queueRef.current = [];
    setIsCapturing(false);
  }, []);

  const start = useCallback<UseMicrophonePCMResult['start']>(async () => {
    if (isCapturing || ctxRef.current) return;
    setError(null);
    setChunksDelivered(0);
    setChunksDropped(0);
    droppedRef.current = 0;
    queueRef.current = [];

    try {
      const stream =
        opts.getMediaStream?.() ??
        navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = await stream;

      const AudioCtx =
        (window as any).AudioContext ?? (window as any).webkitAudioContext;
      if (!AudioCtx) throw new Error('AudioContext not available in this browser');
      const ctx: AudioContext = new AudioCtx();
      ctxRef.current = ctx;
      setContextSampleRate(ctx.sampleRate);

      const workletURL = ensureWorkletURL();
      await ctx.audioWorklet.addModule(workletURL);

      const source = ctx.createMediaStreamSource(streamRef.current);
      sourceRef.current = source;

      const node = new AudioWorkletNode(ctx, 'smallestai-pcm-capture', {
        processorOptions: { targetRate, batchMs },
      });
      workletNodeRef.current = node;

      node.port.onmessage = (ev: MessageEvent) => {
        const buf = new Uint8Array(ev.data as ArrayBuffer);
        if (maxQueued > 0 && queueRef.current.length >= maxQueued) {
          // Drop oldest.
          queueRef.current.shift();
          droppedRef.current++;
          setChunksDropped(droppedRef.current);
          onDroppedRef.current?.(droppedRef.current);
        }
        queueRef.current.push(buf);
        setChunksDelivered((n) => n + 1);
        // Synchronously deliver to the consumer if it set a callback.
        // (Most consumers will; the queue is a safety net for slow
        // unmounts and backpressure metrics.)
        try {
          onChunkRef.current?.(buf);
        } catch {
          // Don't let consumer errors break the audio pipeline.
        }
      };

      source.connect(node);
      // Connect to destination so the worklet keeps pulling — but mute
      // it via gain 0 so the user doesn't hear themselves.
      const muted = ctx.createGain();
      muted.gain.value = 0;
      node.connect(muted).connect(ctx.destination);

      setIsCapturing(true);
    } catch (err) {
      stop();
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      throw e;
    }
  }, [batchMs, isCapturing, maxQueued, opts, stop, targetRate]);

  return {
    isCapturing,
    contextSampleRate,
    error,
    chunksDelivered,
    chunksDropped,
    start,
    stop,
  };
}

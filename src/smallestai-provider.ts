import type { SpeechModelV2, TranscriptionModelV2 } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { SmallestAISpeechModel } from './smallestai-speech-model';
import type { SmallestAISpeechModelId } from './smallestai-speech-options';
import { SmallestAITranscriptionModel } from './smallestai-transcription-model';
import type { SmallestAITranscriptionModelId } from './smallestai-transcription-options';
import { SmallestAIVoiceCloneClient } from './smallestai-voice-clone';
import {
  SmallestAITranscriptionStream,
  type SmallestAITranscriptionStreamOptions,
} from './smallestai-transcription-stream';
import { VERSION } from './version';

export interface SmallestAIProvider {
  speech(modelId: SmallestAISpeechModelId): SpeechModelV2;
  speechModel(modelId: SmallestAISpeechModelId): SpeechModelV2;
  transcription(modelId: SmallestAITranscriptionModelId): TranscriptionModelV2;
  transcriptionModel(modelId: SmallestAITranscriptionModelId): TranscriptionModelV2;
  /**
   * Voice cloning REST client (`/waves/v1/voice-cloning/`).
   * Sits outside the Vercel AI SDK interfaces because the spec has no
   * `VoiceCloneModelV2` — but it's the same auth, base URL, and fetch
   * config as the rest of the provider.
   */
  voiceClone: SmallestAIVoiceCloneClient;

  /**
   * Open a streaming WebSocket transcription session against
   * `/waves/v1/{modelId}/get_text`. The Vercel AI SDK's
   * `TranscriptionModelV2` is one-shot, so streaming lives here as a
   * separate API. Every WS-only feature flag is supported:
   * `itnNormalize`, `sentenceTimestamps`, `fullTranscript`,
   * `finalizeOnWords`, `maxWords`, etc.
   *
   * Usage:
   *   const stream = smallestai.transcriptionStream('pulse', {
   *     language: 'en', encoding: 'linear16', sampleRate: 16000,
   *     itnNormalize: true, redactPii: true, sentenceTimestamps: true,
   *   });
   *   await stream.connect();
   *   stream.sendAudio(chunk);
   *   stream.finalize();
   *   for await (const msg of stream) {
   *     if (msg.is_final) console.log(msg.transcript);
   *     if (msg.is_last) break;
   *   }
   */
  transcriptionStream(
    modelId: SmallestAITranscriptionModelId,
    options: SmallestAITranscriptionStreamOptions,
  ): SmallestAITranscriptionStream;
}

export interface SmallestAIProviderSettings {
  /**
   * Smallest AI API key. Defaults to `SMALLEST_API_KEY` env var.
   * Get yours at https://waves.smallest.ai
   */
  apiKey?: string;

  /**
   * Base URL for the Smallest AI API.
   * @default 'https://api.smallest.ai'
   */
  baseURL?: string;

  /**
   * Custom headers to include in requests.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation.
   */
  fetch?: FetchFunction;
}

export function createSmallestAI(
  options: SmallestAIProviderSettings = {},
): SmallestAIProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ?? 'https://api.smallest.ai';

  const getHeaders = () => ({
    Authorization: `Bearer ${loadApiKey({
      apiKey: options.apiKey,
      environmentVariableName: 'SMALLEST_API_KEY',
      description: 'Smallest AI',
    })}`,
    'User-Agent': `smallest-ai-vercel-provider/${VERSION}`,
    ...options.headers,
  });

  const sharedConfig = {
    url: ({ path }: { path: string }) => `${baseURL}${path}`,
    headers: getHeaders,
    fetch: options.fetch,
  };

  const createSpeechModel = (modelId: SmallestAISpeechModelId) =>
    new SmallestAISpeechModel(modelId, {
      provider: 'smallestai.speech',
      ...sharedConfig,
    });

  const createTranscriptionModel = (
    modelId: SmallestAITranscriptionModelId,
  ) =>
    new SmallestAITranscriptionModel(modelId, {
      provider: 'smallestai.transcription',
      ...sharedConfig,
    });

  const voiceClone = new SmallestAIVoiceCloneClient({
    provider: 'smallestai.voiceClone',
    ...sharedConfig,
  });

  const transcriptionStream = (
    modelId: SmallestAITranscriptionModelId,
    streamOptions: SmallestAITranscriptionStreamOptions,
  ) =>
    new SmallestAITranscriptionStream(modelId, streamOptions, {
      apiKey: options.apiKey,
      baseURL,
    });

  const provider: SmallestAIProvider = {
    speech: createSpeechModel,
    speechModel: createSpeechModel,
    transcription: createTranscriptionModel,
    transcriptionModel: createTranscriptionModel,
    voiceClone,
    transcriptionStream,
  };

  return provider;
}

/**
 * Default Smallest AI provider instance.
 * Uses `SMALLEST_API_KEY` environment variable for authentication.
 */
export const smallestai = createSmallestAI();

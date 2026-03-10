import type { SpeechModelV2, TranscriptionModelV2 } from '@ai-sdk/provider';
import type { FetchFunction } from '@ai-sdk/provider-utils';
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { SmallestAISpeechModel } from './smallestai-speech-model';
import type { SmallestAISpeechModelId } from './smallestai-speech-options';
import { SmallestAITranscriptionModel } from './smallestai-transcription-model';
import type { SmallestAITranscriptionModelId } from './smallestai-transcription-options';
import { VERSION } from './version';

export interface SmallestAIProvider {
  speech(modelId: SmallestAISpeechModelId): SpeechModelV2;
  speechModel(modelId: SmallestAISpeechModelId): SpeechModelV2;
  transcription(modelId: SmallestAITranscriptionModelId): TranscriptionModelV2;
  transcriptionModel(modelId: SmallestAITranscriptionModelId): TranscriptionModelV2;
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

  const createSpeechModel = (modelId: SmallestAISpeechModelId) =>
    new SmallestAISpeechModel(modelId, {
      provider: 'smallestai.speech',
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const createTranscriptionModel = (
    modelId: SmallestAITranscriptionModelId,
  ) =>
    new SmallestAITranscriptionModel(modelId, {
      provider: 'smallestai.transcription',
      url: ({ path }) => `${baseURL}${path}`,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider: SmallestAIProvider = {
    speech: createSpeechModel,
    speechModel: createSpeechModel,
    transcription: createTranscriptionModel,
    transcriptionModel: createTranscriptionModel,
  };

  return provider;
}

/**
 * Default Smallest AI provider instance.
 * Uses `SMALLEST_API_KEY` environment variable for authentication.
 */
export const smallestai = createSmallestAI();

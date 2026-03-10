import type { SpeechModelV2 } from '@ai-sdk/provider';
import {
  combineHeaders,
  createBinaryResponseHandler,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { SmallestAIConfig } from './smallestai-config';
import type { SmallestAISpeechModelId } from './smallestai-speech-options';
import { smallestaiFailedResponseHandler } from './smallestai-error';

const smallestaiSpeechProviderOptionsSchema = z.object({
  sampleRate: z
    .union([
      z.literal(8000),
      z.literal(16000),
      z.literal(24000),
      z.literal(44100),
      z.literal(48000),
    ])
    .optional(),
  consistency: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  enhancement: z.number().min(0).max(2).optional(),
  outputFormat: z
    .enum(['pcm', 'mp3', 'wav', 'mulaw'])
    .optional(),
});

export type SmallestAISpeechProviderOptions = z.infer<
  typeof smallestaiSpeechProviderOptionsSchema
>;

export class SmallestAISpeechModel implements SpeechModelV2 {
  readonly specificationVersion = 'v2' as const;

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: SmallestAISpeechModelId,
    private readonly config: SmallestAIConfig,
  ) {}

  async doGenerate(
    options: Parameters<SpeechModelV2['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<SpeechModelV2['doGenerate']>>> {
    const { text, voice, speed, language, providerOptions, headers, abortSignal } =
      options;

    const smallestaiOptions = await parseProviderOptions({
      provider: 'smallestai',
      providerOptions,
      schema: smallestaiSpeechProviderOptionsSchema,
    });

    const outputFormat = smallestaiOptions?.outputFormat ?? 'wav';

    const requestBody = {
      text,
      voice_id: voice ?? 'diana',
      sample_rate: smallestaiOptions?.sampleRate ?? 24000,
      speed: speed ?? 1.0,
      language: language ?? 'en',
      output_format: outputFormat,
      ...(smallestaiOptions?.consistency !== undefined && {
        consistency: smallestaiOptions.consistency,
      }),
      ...(smallestaiOptions?.similarity !== undefined && {
        similarity: smallestaiOptions.similarity,
      }),
      ...(smallestaiOptions?.enhancement !== undefined && {
        enhancement: smallestaiOptions.enhancement,
      }),
    };

    const warnings: Awaited<ReturnType<SpeechModelV2['doGenerate']>>['warnings'] = [];

    if (options.outputFormat && options.outputFormat !== outputFormat) {
      warnings.push({
        type: 'unsupported-setting' as const,
        setting: 'outputFormat' as const,
        details: `Requested format '${options.outputFormat}' ignored. Use providerOptions.smallestai.outputFormat instead.`,
      });
    }

    if (options.instructions) {
      warnings.push({
        type: 'unsupported-setting' as const,
        setting: 'instructions' as const,
        details: 'Smallest AI does not support speech instructions.',
      });
    }

    const {
      value: audio,
      responseHeaders,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: `/waves/v1/${this.modelId}/get_speech`,
        modelId: this.modelId,
      }),
      headers: combineHeaders(this.config.headers(), headers),
      body: requestBody,
      failedResponseHandler: smallestaiFailedResponseHandler,
      successfulResponseHandler: createBinaryResponseHandler(),
      abortSignal,
      fetch: this.config.fetch,
    });

    return {
      audio,
      warnings,
      request: { body: JSON.stringify(requestBody) },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawResponse,
      },
    };
  }
}

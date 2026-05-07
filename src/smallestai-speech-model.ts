import type { SpeechModelV2 } from '@ai-sdk/provider';
import {
  combineHeaders,
  createBinaryResponseHandler,
  parseProviderOptions,
  postJsonToApi,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { SmallestAIConfig } from './smallestai-config';
import {
  DEFAULT_LIGHTNING_MODEL,
  type SmallestAISpeechModelId,
} from './smallestai-speech-options';
import { smallestaiFailedResponseHandler } from './smallestai-error';

const smallestaiSpeechProviderOptionsSchema = z.object({
  sampleRate: z
    .union([
      z.literal(8000),
      z.literal(16000),
      z.literal(24000),
      z.literal(44100),
    ])
    .optional(),
  similarity: z.number().min(0).max(1).optional(),
  enhancement: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
  outputFormat: z.enum(['pcm', 'mp3', 'wav', 'mulaw', 'alaw', 'ulaw']).optional(),
  addWavHeader: z.boolean().optional(),
  saveHistory: z.boolean().optional(),
  pronunciationDicts: z.array(z.string()).optional(),
});

export type SmallestAISpeechProviderOptions = z.infer<
  typeof smallestaiSpeechProviderOptionsSchema
>;

const SUPPORTED_MODELS = new Set<string>([DEFAULT_LIGHTNING_MODEL]);

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

    const warnings: Awaited<ReturnType<SpeechModelV2['doGenerate']>>['warnings'] = [];

    if (!SUPPORTED_MODELS.has(this.modelId)) {
      warnings.push({
        type: 'other' as const,
        message: `Unknown speech model '${this.modelId}'. Only '${DEFAULT_LIGHTNING_MODEL}' is supported.`,
      });
    }

    const normalizedOutputFormat =
      smallestaiOptions?.outputFormat === 'ulaw'
        ? 'mulaw'
        : smallestaiOptions?.outputFormat;
    const outputFormat = normalizedOutputFormat ?? 'wav';

    const requestBody: Record<string, unknown> = {
      text,
      voice_id: voice ?? 'sophia',
      sample_rate: smallestaiOptions?.sampleRate ?? 44100,
      speed: speed ?? 1.0,
      language: language ?? 'auto',
      output_format: outputFormat,
    };

    if (smallestaiOptions?.addWavHeader !== undefined) {
      requestBody.add_wav_header = smallestaiOptions.addWavHeader;
    }
    if (smallestaiOptions?.saveHistory !== undefined) {
      requestBody.save_history = smallestaiOptions.saveHistory;
    }
    if (
      smallestaiOptions?.pronunciationDicts &&
      smallestaiOptions.pronunciationDicts.length > 0
    ) {
      requestBody.pronunciation_dicts = smallestaiOptions.pronunciationDicts;
    }
    if (smallestaiOptions?.similarity !== undefined) {
      requestBody.similarity = smallestaiOptions.similarity;
    }
    if (smallestaiOptions?.enhancement !== undefined) {
      requestBody.enhancement = smallestaiOptions.enhancement;
    }

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
        details:
          "Smallest AI ignores the Vercel AI SDK 'instructions' field on lightning-v3.1.",
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

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

// Fields accepted by the unified `POST /waves/v1/tts` route
// (waves-platform tts schema): text, voice_id, model, sample_rate,
// speed, output_format, pronunciation_dicts. The legacy per-model
// `get_speech` route's extra knobs (similarity, enhancement,
// add_wav_header, save_history) are not part of the unified schema and
// were silently stripped — removed here so the surface matches the API.
const smallestaiSpeechProviderOptionsSchema = z.object({
  sampleRate: z
    .union([
      z.literal(8000),
      z.literal(16000),
      z.literal(24000),
      z.literal(44100),
    ])
    .optional(),
  outputFormat: z.enum(['pcm', 'mp3', 'wav', 'mulaw', 'alaw', 'ulaw']).optional(),
  pronunciationDicts: z.array(z.string()).optional(),
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

    const warnings: Awaited<ReturnType<SpeechModelV2['doGenerate']>>['warnings'] = [];

    // Server accepts ['wav', 'ulaw', 'alaw', 'pcm', 'mp3'] (see waves-platform
    // lightning-v3.schema.ts). The SDK additionally accepts 'mulaw' as a
    // friendlier alias and normalizes it to 'ulaw' before POST.
    const normalizedOutputFormat =
      smallestaiOptions?.outputFormat === 'mulaw'
        ? 'ulaw'
        : smallestaiOptions?.outputFormat;
    const outputFormat = normalizedOutputFormat ?? 'wav';

    const requestBody: Record<string, unknown> = {
      text,
      voice_id: voice ?? 'sophia',
      model: this.modelId,
      sample_rate: smallestaiOptions?.sampleRate ?? 44100,
      speed: speed ?? 1.0,
      language: language ?? 'auto',
      output_format: outputFormat,
    };

    if (
      smallestaiOptions?.pronunciationDicts &&
      smallestaiOptions.pronunciationDicts.length > 0
    ) {
      requestBody.pronunciation_dicts = smallestaiOptions.pronunciationDicts;
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
          "Smallest AI ignores the Vercel AI SDK 'instructions' field on Lightning models.",
      });
    }

    const {
      value: audio,
      responseHeaders,
      rawValue: rawResponse,
    } = await postJsonToApi({
      url: this.config.url({
        path: `/waves/v1/tts`,
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

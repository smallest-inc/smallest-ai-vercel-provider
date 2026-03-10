import type { TranscriptionModelV2 } from '@ai-sdk/provider';
import {
  combineHeaders,
  convertBase64ToUint8Array,
  parseProviderOptions,
} from '@ai-sdk/provider-utils';
import { z } from 'zod';
import type { SmallestAIConfig } from './smallestai-config';
import type { SmallestAITranscriptionModelId } from './smallestai-transcription-options';

const smallestaiTranscriptionProviderOptionsSchema = z.object({
  language: z.string().optional(),
  diarize: z.boolean().optional(),
  emotionDetection: z.boolean().optional(),
  ageDetection: z.boolean().optional(),
  genderDetection: z.boolean().optional(),
});

export type SmallestAITranscriptionProviderOptions = z.infer<
  typeof smallestaiTranscriptionProviderOptionsSchema
>;

const wordSchema = z.object({
  word: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.union([z.string(), z.number()]).optional(),
  confidence: z.number().optional(),
});

const responseSchema = z.object({
  transcription: z.string().optional(),
  text: z.string().optional(),
  audio_length: z.number().optional(),
  words: z.array(wordSchema).optional(),
  utterances: z
    .array(
      z.object({
        text: z.string(),
        start: z.number().optional(),
        end: z.number().optional(),
        speaker: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .optional(),
});

export class SmallestAITranscriptionModel implements TranscriptionModelV2 {
  readonly specificationVersion = 'v2' as const;

  get provider(): string {
    return this.config.provider;
  }

  constructor(
    readonly modelId: SmallestAITranscriptionModelId,
    private readonly config: SmallestAIConfig,
  ) {}

  async doGenerate(
    options: Parameters<TranscriptionModelV2['doGenerate']>[0],
  ): Promise<Awaited<ReturnType<TranscriptionModelV2['doGenerate']>>> {
    const { audio, mediaType, providerOptions, headers, abortSignal } = options;

    const smallestaiOptions = await parseProviderOptions({
      provider: 'smallestai',
      providerOptions,
      schema: smallestaiTranscriptionProviderOptionsSchema,
    });

    const audioData =
      typeof audio === 'string' ? convertBase64ToUint8Array(audio) : audio;

    const language = smallestaiOptions?.language ?? 'en';

    const queryParams = new URLSearchParams({
      model: 'pulse',
      language,
      word_timestamps: 'true',
      diarize: String(smallestaiOptions?.diarize ?? false),
      emotion_detection: String(smallestaiOptions?.emotionDetection ?? false),
    });

    if (smallestaiOptions?.ageDetection) {
      queryParams.set('age_detection', 'true');
    }
    if (smallestaiOptions?.genderDetection) {
      queryParams.set('gender_detection', 'true');
    }

    const url = this.config.url({
      path: `/waves/v1/pulse/get_text?${queryParams.toString()}`,
      modelId: this.modelId,
    });

    const mergedHeaders = combineHeaders(this.config.headers(), headers, {
      'Content-Type': mediaType || 'audio/wav',
    });

    const fetchFn = this.config.fetch ?? fetch;

    const response = await fetchFn(url, {
      method: 'POST',
      headers: mergedHeaders as Record<string, string>,
      body: audioData as unknown as BodyInit,
      signal: abortSignal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Smallest AI transcription failed (HTTP ${response.status}): ${errorBody}`,
      );
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const rawBody = await response.json();
    const parsed = responseSchema.parse(rawBody);

    const transcriptionText = parsed.transcription ?? parsed.text ?? '';

    const segments =
      parsed.words?.map((word) => ({
        text: word.word,
        startSecond: word.start ?? 0,
        endSecond: word.end ?? 0,
      })) ?? [];

    const lastWord = parsed.words?.at(-1);
    const durationInSeconds = parsed.audio_length ?? lastWord?.end ?? undefined;

    const warnings: Awaited<
      ReturnType<TranscriptionModelV2['doGenerate']>
    >['warnings'] = [];

    return {
      text: transcriptionText,
      segments,
      language,
      durationInSeconds,
      warnings,
      request: { body: `POST ${url}` },
      response: {
        timestamp: new Date(),
        modelId: this.modelId,
        headers: responseHeaders,
        body: rawBody,
      },
    };
  }
}

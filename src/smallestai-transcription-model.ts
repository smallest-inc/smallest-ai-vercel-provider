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
  // Sent as multipart of query params on /waves/v1/pulse/get_text
  diarize: z.boolean().optional(),
  emotionDetection: z.boolean().optional(),
  genderDetection: z.boolean().optional(),
  /**
   * @deprecated Removed from server in waves-platform PR #757. Will be ignored.
   */
  ageDetection: z.boolean().optional(),
  wordTimestamps: z.boolean().optional(),
  punctuate: z.boolean().optional(),
  capitalize: z.boolean().optional(),
  // Privacy redaction
  redactPii: z.boolean().optional(),
  redactPci: z.boolean().optional(),
  // Numeric handling: 'true' | 'false' | 'auto'
  numerals: z.enum(['true', 'false', 'auto']).optional(),
  // Comma-joined keyword boost list (or array; we'll join)
  keywords: z.array(z.string()).optional(),
  // Webhook delivery
  webhookUrl: z.string().url().optional(),
  webhookMethod: z.enum(['POST', 'GET']).optional(),
  webhookExtra: z.string().optional(),
  // Streaming/WS-only knobs (forwarded as query params; backend ignores
  // them on REST today and applies them on WS — we still accept them so
  // callers can opt-in once REST exposes them).
  itnNormalize: z.boolean().optional(),
  sentenceTimestamps: z.boolean().optional(),
  fullTranscript: z.boolean().optional(),
  finalizeOnWords: z.boolean().optional(),
  maxWords: z.number().int().positive().optional(),
});

export type SmallestAITranscriptionProviderOptions = z.infer<
  typeof smallestaiTranscriptionProviderOptionsSchema
>;

const wordSchema = z.object({
  word: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.union([z.string(), z.number()]).optional(),
  speaker_confidence: z.number().optional(),
  confidence: z.number().optional(),
});

const utteranceSchema = z.object({
  text: z.string(),
  start: z.number().optional(),
  end: z.number().optional(),
  speaker: z.union([z.string(), z.number()]).optional(),
});

const responseSchema = z.object({
  request_id: z.string().optional(),
  status: z.string().optional(),
  transcription: z.string().optional(),
  text: z.string().optional(),
  audio_length: z.number().optional(),
  words: z.array(wordSchema).optional(),
  utterances: z.array(utteranceSchema).optional(),
  age: z.string().optional(),
  gender: z.string().optional(),
  emotions: z.record(z.number()).optional(),
  metadata: z
    .object({
      duration: z.number().optional(),
      fileSize: z.number().optional(),
    })
    .optional(),
});

const setBool = (params: URLSearchParams, key: string, value: boolean) => {
  params.set(key, value ? 'true' : 'false');
};

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

    const queryParams = new URLSearchParams({ language });

    setBool(queryParams, 'word_timestamps', smallestaiOptions?.wordTimestamps ?? true);
    setBool(queryParams, 'diarize', smallestaiOptions?.diarize ?? false);
    setBool(queryParams, 'emotion_detection', smallestaiOptions?.emotionDetection ?? false);
    setBool(queryParams, 'gender_detection', smallestaiOptions?.genderDetection ?? false);

    if (smallestaiOptions?.ageDetection !== undefined) {
      setBool(queryParams, 'age_detection', smallestaiOptions.ageDetection);
    }
    if (smallestaiOptions?.punctuate !== undefined) {
      setBool(queryParams, 'punctuate', smallestaiOptions.punctuate);
    }
    if (smallestaiOptions?.capitalize !== undefined) {
      setBool(queryParams, 'capitalize', smallestaiOptions.capitalize);
    }
    if (smallestaiOptions?.redactPii !== undefined) {
      setBool(queryParams, 'redact_pii', smallestaiOptions.redactPii);
    }
    if (smallestaiOptions?.redactPci !== undefined) {
      setBool(queryParams, 'redact_pci', smallestaiOptions.redactPci);
    }
    if (smallestaiOptions?.numerals !== undefined) {
      queryParams.set('numerals', smallestaiOptions.numerals);
    }
    if (smallestaiOptions?.keywords && smallestaiOptions.keywords.length > 0) {
      queryParams.set('keywords', smallestaiOptions.keywords.join(','));
    }
    if (smallestaiOptions?.webhookUrl) {
      queryParams.set('webhook_url', smallestaiOptions.webhookUrl);
    }
    if (smallestaiOptions?.webhookMethod) {
      queryParams.set('webhook_method', smallestaiOptions.webhookMethod);
    }
    if (smallestaiOptions?.webhookExtra) {
      queryParams.set('webhook_extra', smallestaiOptions.webhookExtra);
    }

    // Streaming/WS-only knobs — forwarded for forward-compat. Server's
    // batch route currently strips unknown keys silently.
    if (smallestaiOptions?.itnNormalize !== undefined) {
      setBool(queryParams, 'itn_normalize', smallestaiOptions.itnNormalize);
    }
    if (smallestaiOptions?.sentenceTimestamps !== undefined) {
      setBool(queryParams, 'sentence_timestamps', smallestaiOptions.sentenceTimestamps);
    }
    if (smallestaiOptions?.fullTranscript !== undefined) {
      setBool(queryParams, 'full_transcript', smallestaiOptions.fullTranscript);
    }
    if (smallestaiOptions?.finalizeOnWords !== undefined) {
      setBool(queryParams, 'finalize_on_words', smallestaiOptions.finalizeOnWords);
    }
    if (smallestaiOptions?.maxWords !== undefined) {
      queryParams.set('max_words', String(smallestaiOptions.maxWords));
    }

    const url = this.config.url({
      path: `/waves/v1/${this.modelId}/get_text?${queryParams.toString()}`,
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

    if (smallestaiOptions?.ageDetection) {
      warnings.push({
        type: 'other' as const,
        message:
          "providerOptions.smallestai.ageDetection has been removed from the Smallest AI ASR API and will be ignored.",
      });
    }

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

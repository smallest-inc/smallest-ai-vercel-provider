export { createSmallestAI, smallestai } from './smallestai-provider';
export type {
  SmallestAIProvider,
  SmallestAIProviderSettings,
} from './smallestai-provider';

export {
  DEFAULT_LIGHTNING_MODEL,
  LIGHTNING_V3_1_LANGUAGES,
} from './smallestai-speech-options';
export type {
  SmallestAISpeechModelId,
  LightningV31Language,
} from './smallestai-speech-options';
export type { SmallestAISpeechProviderOptions } from './smallestai-speech-model';

export type { SmallestAITranscriptionModelId } from './smallestai-transcription-options';
export type { SmallestAITranscriptionProviderOptions } from './smallestai-transcription-model';

export { SmallestAIVoiceCloneClient } from './smallestai-voice-clone';
export type {
  VoiceCloneCreateOptions,
  VoiceCloneRecord,
} from './smallestai-voice-clone';

export { SmallestAITranscriptionStream } from './smallestai-transcription-stream';
export type {
  SmallestAITranscriptionStreamOptions,
  SmallestAITranscriptionStreamMessage,
  SmallestAITranscriptionStreamConfig,
} from './smallestai-transcription-stream';

export {
  createTranscriptionStreamSSEResponse,
  parseTranscriptionStreamSSE,
} from './smallestai-sse';

export { VERSION } from './version';

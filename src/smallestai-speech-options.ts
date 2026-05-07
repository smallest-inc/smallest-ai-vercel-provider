/**
 * Single source of truth for which TTS model the SDK supports.
 * Bump here (and re-publish) when waves-platform ships a new
 * Lightning version. The SDK drift detector will flag the moment a
 * waves-platform PR touches a TTS schema, see
 * `.github/workflows/sdk-drift-detector.yml`.
 */
export const DEFAULT_LIGHTNING_MODEL = 'lightning-v3.1' as const;

export type SmallestAISpeechModelId =
  | typeof DEFAULT_LIGHTNING_MODEL
  | (string & {});

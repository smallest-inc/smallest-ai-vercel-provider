/**
 * Default Lightning model id used by examples and the new-default flow.
 *
 * The SDK is model-agnostic: any model id you pass is substituted into
 * the URL path `/waves/v1/{modelId}/get_speech`, so when waves-platform
 * ships a new Lightning version (e.g. `lightning-v3.2`) you can call
 * `smallestai.speech('lightning-v3.2')` without bumping this package.
 *
 * Bump this constant when the recommended default changes — that lets
 * downstream apps importing `DEFAULT_LIGHTNING_MODEL` follow you
 * automatically. The SDK drift detector workflow flags the moment a
 * waves-platform PR touches a TTS schema so you know when to bump.
 */
export const DEFAULT_LIGHTNING_MODEL = 'lightning-v3.1' as const;

/**
 * Free-form string. Pass any model id supported by waves-platform
 * (e.g. `'lightning-v3.1'`, future `'lightning-v3.2'`, ...).
 * `DEFAULT_LIGHTNING_MODEL` autocompletes the recommended default.
 */
export type SmallestAISpeechModelId =
  | typeof DEFAULT_LIGHTNING_MODEL
  | (string & {});

/**
 * Languages supported by `lightning-v3.1`, mirroring the server enum
 * (`API_LIGHTNING_V3_1_LANGUAGES` in `lightning-v3.schema.ts`). Includes
 * `'auto'` for automatic language detection (the v3.1 default).
 */
export const LIGHTNING_V3_1_LANGUAGES = [
  'auto',
  'en', 'hi', 'mr', 'kn', 'ta', 'bn', 'gu',
  'de', 'fr', 'es', 'it', 'pl', 'nl', 'ru',
  'ar', 'he', 'sv', 'ml', 'te', 'pt', 'pa', 'or',
] as const;

/**
 * Type narrowing for `lightning-v3.1` callers. Use as the `language`
 * field on `generateSpeech({ ... })` to get autocomplete + a type
 * error on unsupported codes.
 */
export type LightningV31Language = typeof LIGHTNING_V3_1_LANGUAGES[number];

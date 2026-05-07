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

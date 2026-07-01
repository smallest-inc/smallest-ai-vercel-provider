/**
 * Default Lightning TTS model id (multilingual, voice-cloning capable).
 *
 * Both Lightning models are selected via the `model` field on the
 * unified `POST /waves/v1/tts` route — there is no separate Pro
 * endpoint. When waves-platform ships a new Lightning version you can
 * call `smallestai.speech('lightning_v3.2')` without bumping this
 * package (the model id is forwarded verbatim as the `model` field).
 *
 * Bump this constant when the recommended default changes — that lets
 * downstream apps importing `DEFAULT_LIGHTNING_MODEL` follow you
 * automatically. The SDK drift detector workflow flags the moment a
 * waves-platform PR touches a TTS schema so you know when to bump.
 */
export const DEFAULT_LIGHTNING_MODEL = 'lightning_v3.1' as const;

/**
 * Premium broadcast-quality Lightning pool (English + Hindi; Indian
 * voices code-switch automatically). No voice cloning. Same latency,
 * rate limits, and routes as the standard model — selected via `model`.
 */
export const LIGHTNING_V3_1_PRO_MODEL = 'lightning_v3.1_pro' as const;

/**
 * Lightning TTS model ids:
 *   - `lightning_v3.1` (default): multilingual + voice cloning.
 *   - `lightning_v3.1_pro`: premium English/Hindi pool, no cloning.
 * The open string keeps forward-compat with future Lightning versions
 * without a package bump. `DEFAULT_LIGHTNING_MODEL` /
 * `LIGHTNING_V3_1_PRO_MODEL` autocomplete the two current pools.
 */
export type SmallestAISpeechModelId =
  | typeof DEFAULT_LIGHTNING_MODEL
  | typeof LIGHTNING_V3_1_PRO_MODEL
  | (string & {});

/**
 * Languages supported by `lightning_v3.1`, mirroring the server enum
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
 * Type narrowing for `lightning_v3.1` callers. Use as the `language`
 * field on `generateSpeech({ ... })` to get autocomplete + a type
 * error on unsupported codes.
 */
export type LightningV31Language = typeof LIGHTNING_V3_1_LANGUAGES[number];

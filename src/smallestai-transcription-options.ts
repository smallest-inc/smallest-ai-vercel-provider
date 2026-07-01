/**
 * Pulse STT model ids:
 *   - `pulse`: 38 languages, HTTP + WebSocket streaming (64ms TTFT).
 *   - `pulse-pro`: leaderboard-ranked English STT, **batch/pre-recorded
 *     only** — there is no streaming worker, so `transcriptionStream`
 *     rejects it. Use it with `smallestai.transcription('pulse-pro')`.
 * The open string keeps forward-compat with future Pulse models.
 */
export type SmallestAITranscriptionModelId =
  | 'pulse'
  | 'pulse-pro'
  | (string & {});

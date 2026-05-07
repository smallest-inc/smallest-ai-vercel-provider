#!/usr/bin/env node
//
// Classify an upstream PR (waves-platform / etc.) for likely impact on
// this Vercel AI SDK provider. Reads PR metadata + diff and asks Claude:
//
//   - Does this PR change a TTS or STT request/response field, default,
//     enum value, or supported language that this SDK exposes via
//     `SmallestAISpeechProviderOptions` or `SmallestAITranscriptionProviderOptions`?
//   - If yes: which SDK files are likely affected?
//   - If no: stay silent.
//
// Output JSON shape (consumed by the workflow):
//   {
//     "verdict": "SDK_NEEDED" | "MAYBE" | "NO_SDK_IMPACT",
//     "summary": "...",
//     "affected_sdk_files": [...],
//     "questions_for_human": [...]
//   }
//
// Designed to be invoked from .github/workflows/sdk-drift-detector.yml.
//
// Required env: ANTHROPIC_API_KEY
// Falls back to a regex-based heuristic when the API key is missing,
// so smoke-tests still produce structured output.

import { readFileSync, writeFileSync } from 'node:fs';
import { argv, env, exit } from 'node:process';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

// ── argv parsing ──────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) args[a.slice(2)] = argv[++i];
}
const required = ['repo', 'pr', 'pr-title', 'pr-url', 'pr-body-file', 'pr-diff-file', 'out-json'];
for (const k of required) {
  if (!args[k]) {
    console.error(`missing --${k}`);
    exit(2);
  }
}

const prBody = safeRead(args['pr-body-file']);
const prDiff = safeRead(args['pr-diff-file']);

// Tight diff so we don't blow up the prompt.
const TRUNC = 60_000;
const diffForPrompt = prDiff.length > TRUNC ? prDiff.slice(0, TRUNC) + '\n…[truncated]' : prDiff;

const SYSTEM = `You audit upstream backend PRs for impact on a downstream Vercel AI SDK
provider package (smallestai-vercel-provider). The SDK exposes:

  - TTS via SpeechModelV2 → POST /waves/v1/{lightning-v3.1|lightning-v3.2}/get_speech
    Provider options surface: text, voice_id, speed, language, sample_rate,
    output_format, similarity, enhancement, add_wav_header, save_history,
    pronunciation_dicts, instruction, enhance_breathing, plus v3.2 Gemini
    controls (emotion / pitch / volume / prosody / accent — strictly enum'd).

  - STT via TranscriptionModelV2 → POST /waves/v1/pulse/get_text
    Query params surface: language, word_timestamps, diarize, emotion_detection,
    gender_detection, redact_pii, redact_pci, numerals, keywords, punctuate,
    capitalize, webhook_url, webhook_method, webhook_extra. Forward-compat
    knobs (WS-only on server today): itn_normalize, sentence_timestamps,
    full_transcript, finalize_on_words, max_words.

You are given the upstream PR title, body, and diff. Output STRICT JSON.

Verdict rules:
  SDK_NEEDED  — PR adds/removes/renames a request param the SDK does not
                forward, changes an enum value the SDK hard-codes (e.g. v3.2
                Gemini emotions/pitches/prosody/etc.), changes a default the
                SDK relies on, alters response shape, or adds a new model id.
  MAYBE       — Changes near the API surface but ambiguous (refactor that
                might shift defaults; new internal field that may be
                user-visible). Lean here when uncertain.
  NO_SDK_IMPACT — Pure backend / infra / tests / unrelated services.

JSON keys (all required):
  verdict             : one of the three strings above
  summary             : 1–3 sentence, plain English. Lead with the change.
  affected_sdk_files  : array of likely SDK files in the package, e.g.
                        "src/smallestai-speech-model.ts",
                        "src/smallestai-transcription-model.ts",
                        "src/smallestai-speech-options.ts",
                        "README.md"
  questions_for_human : array of pointed questions the maintainer must answer
                        to make the SDK update correct. Empty array if none.

No prose outside the JSON. Do not include backticks.`;

const PROMPT_USER = `Upstream repo: ${args.repo}
PR #${args.pr}: ${args['pr-title']}
URL: ${args['pr-url']}

PR BODY
-------
${prBody || '(empty)'}

PR DIFF (truncated to ${TRUNC} chars)
-------------------------------------
${diffForPrompt || '(empty)'}
`;

const result = await classify();
writeFileSync(args['out-json'], JSON.stringify(result, null, 2));
console.log('verdict:', result.verdict);

// ──────────────────────────────────────────────────────────────────────
function safeRead(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

async function classify() {
  if (!env.ANTHROPIC_API_KEY) {
    console.warn('ANTHROPIC_API_KEY not set — using regex heuristic.');
    return regexHeuristic();
  }
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: PROMPT_USER }],
      }),
    });
    if (!res.ok) {
      console.error('anthropic error', res.status, await res.text().catch(() => ''));
      return regexHeuristic();
    }
    const body = await res.json();
    const text = body.content?.[0]?.text ?? '';
    const trimmed = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(trimmed);
    normalize(parsed);
    return parsed;
  } catch (err) {
    console.error('classifier failure, falling back to heuristic:', err?.message ?? err);
    return regexHeuristic();
  }
}

function normalize(p) {
  const allowed = new Set(['SDK_NEEDED', 'MAYBE', 'NO_SDK_IMPACT']);
  if (!allowed.has(p.verdict)) p.verdict = 'MAYBE';
  if (typeof p.summary !== 'string') p.summary = '';
  if (!Array.isArray(p.affected_sdk_files)) p.affected_sdk_files = [];
  if (!Array.isArray(p.questions_for_human)) p.questions_for_human = [];
}

function regexHeuristic() {
  // Path-based hints. Touching any of these directories almost always
  // requires an SDK look.
  const hot = [
    /lightning-v3.*\.schema\.ts/,
    /lightning-v3.*\.controller\.ts/,
    /pulse[/.].*asr.*\.schema\.ts/,
    /gemini-prompt\.ts/,
    /openapi-spec\/.*(tts|asr|pulse|stt)/,
  ];
  // Token-based hints. Adding a key in any schema file is a signal.
  const tokens = [
    'voice_id', 'sample_rate', 'output_format', 'enhancement', 'similarity',
    'pronunciation_dicts', 'add_wav_header', 'save_history', 'instruction',
    'enhance_breathing', 'emotion', 'pitch', 'volume', 'prosody', 'accent',
    'redact_pii', 'redact_pci', 'numerals', 'keywords', 'punctuate', 'capitalize',
    'itn_normalize', 'sentence_timestamps', 'full_transcript', 'webhook_url',
    'GEMINI_EMOTIONS', 'GEMINI_PITCHES', 'GEMINI_VOLUMES',
  ];
  const pathHit = hot.some((rx) => rx.test(prDiff));
  const tokenHit = tokens.some((t) => prDiff.includes(t));
  const verdict = pathHit && tokenHit ? 'SDK_NEEDED' : pathHit || tokenHit ? 'MAYBE' : 'NO_SDK_IMPACT';
  return {
    verdict,
    summary:
      verdict === 'NO_SDK_IMPACT'
        ? 'Heuristic found no TTS/STT schema-level signals in the diff.'
        : 'Heuristic match: TTS/STT schema-adjacent diff detected. Verify the SDK options surface.',
    affected_sdk_files: pathHit
      ? [
          'src/smallestai-speech-model.ts',
          'src/smallestai-transcription-model.ts',
          'src/smallestai-speech-options.ts',
          'README.md',
        ]
      : [],
    questions_for_human: [],
  };
}

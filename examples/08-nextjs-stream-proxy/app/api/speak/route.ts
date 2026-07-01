import { generateSpeech } from 'ai';
import {
  smallestai,
  DEFAULT_LIGHTNING_MODEL,
} from 'smallestai-vercel-provider';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { text, voice, language } = await req.json();

  const { audio, warnings } = await generateSpeech({
    model: smallestai.speech(DEFAULT_LIGHTNING_MODEL),
    text: text || 'Hello!',
    voice: voice || 'sophia',
    language: language ?? 'auto',
    providerOptions: {
      smallestai: {
        outputFormat: 'mp3',
      },
    },
  });

  return new Response(audio.uint8Array, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'X-SDK-Warnings': JSON.stringify(warnings),
    },
  });
}

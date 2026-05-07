import { smallestai } from 'smallestai-vercel-provider';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/voice-clone/delete — body: { voiceId }
export async function POST(req: NextRequest) {
  const { voiceId } = (await req.json()) as { voiceId?: string };
  if (!voiceId) {
    return Response.json({ error: 'voiceId required' }, { status: 400 });
  }
  const res = await smallestai.voiceClone.delete(voiceId);
  return Response.json(res);
}

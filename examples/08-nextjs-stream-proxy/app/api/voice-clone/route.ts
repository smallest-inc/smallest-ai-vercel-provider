import { smallestai } from 'smallestai-vercel-provider';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/voice-clone — list every clone in the org
export async function GET() {
  const data = await smallestai.voiceClone.list();
  return Response.json({ data });
}

// POST /api/voice-clone — multipart create
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const displayName = form.get('displayName') as string | null;
  if (!file || !displayName) {
    return Response.json(
      { error: 'file and displayName are required' },
      { status: 400 },
    );
  }

  const tagsRaw = form.get('tags');
  const tags = typeof tagsRaw === 'string' ? tagsRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  const record = await smallestai.voiceClone.create({
    file,
    fileName: file.name,
    mimeType: file.type || undefined,
    displayName,
    description: (form.get('description') as string | null) ?? undefined,
    accent: (form.get('accent') as string | null) ?? undefined,
    tags,
    language: (form.get('language') as string | null) ?? undefined,
    model: (form.get('model') as string | null) ?? undefined,
  });
  return Response.json({ data: record });
}

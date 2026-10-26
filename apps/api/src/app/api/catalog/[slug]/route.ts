import { NextResponse, type NextRequest } from 'next/server';
import { findCatalogEntry } from '@growspace/shared';
import { jsonError } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const entry = findCatalogEntry(slug);
  if (!entry || !entry.isPublished) {
    return jsonError(404, 'not_found', 'Plant reference not found.');
  }
  return NextResponse.json(entry);
}

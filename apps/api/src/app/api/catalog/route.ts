import { NextResponse, type NextRequest } from 'next/server';
import { PLANT_CATALOG } from '@growspace/shared';

export const dynamic = 'force-dynamic';

export function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() ?? '';
  const category = request.nextUrl.searchParams.get('category')?.trim().toLowerCase() ?? '';

  const entries = PLANT_CATALOG.filter((entry) => {
    if (!entry.isPublished) return false;
    if (category && entry.category.toLowerCase() !== category) return false;
    if (!query) return true;
    return (
      entry.commonName.toLowerCase().includes(query) ||
      (entry.scientificName?.toLowerCase().includes(query) ?? false) ||
      entry.category.toLowerCase().includes(query)
    );
  }).sort((a, b) => a.commonName.localeCompare(b.commonName));

  return NextResponse.json(entries);
}

import { NextResponse, type NextRequest } from 'next/server';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { findResearchRecordById } from '@/lib/research/research-repository';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/plants/research/[id]
 * Retrieves a saved plant research record for the authenticated user.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireUser(request);
    const { id } = await context.params;

    if (!isValidUuid(id)) {
      throw new AppError(400, 'invalid_parameter', 'Invalid research record ID format.');
    }

    const db = getAuthDb();
    const record = await findResearchRecordById(db, id, user.id);

    if (!record) {
      throw new AppError(404, 'not_found', 'Research record not found.');
    }

    return NextResponse.json(
      { researchRecord: record },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

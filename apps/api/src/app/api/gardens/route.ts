import { NextResponse, type NextRequest } from 'next/server';
import { gardenInputSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { createGarden, findGardensByUserId } from '@/lib/gardens/garden-repository';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gardens
 * Lists all gardens belonging to the authenticated user.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const db = getAuthDb();
    const gardens = await findGardensByUserId(db, user.id);

    return NextResponse.json(
      { gardens },
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

/**
 * POST /api/gardens
 * Creates a new garden belonging to the authenticated user.
 * Validates body with gardenInputSchema.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError(400, 'bad_request', 'Invalid JSON body in request.');
    }

    const input = gardenInputSchema.parse(rawBody);
    const db = getAuthDb();
    const garden = await createGarden(db, user.id, input);

    return NextResponse.json({ garden }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

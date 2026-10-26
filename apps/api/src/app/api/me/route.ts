import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);

    // Provide safe public user representation without session secrets or internal database hashes
    const safeUser = {
      uid: user.uid,
      id: user.id,
      email: user.email,
      name: user.name,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      authProvider: user.authProvider,
      temperatureUnit: user.temperatureUnit,
    };

    return NextResponse.json(
      { user: safeUser },
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

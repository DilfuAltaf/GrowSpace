import { NextResponse } from 'next/server';
import {
  getGroqApiKey,
  getGroqModel,
  getSearchConfig,
  isDatabaseConfigured,
  isEmailConfigured,
  isRateLimitConfigured,
} from '@/lib/env';
import { probeDatabase } from '@/lib/health';

export const dynamic = 'force-dynamic';

/**
 * Public readiness endpoint.
 *
 * - 200 when the database answers a trivial query (AI providers are optional and
 *   never affect readiness).
 * - 503 when the database is not configured or unreachable, so managed hosting
 *   platforms withhold traffic from an instance that cannot serve requests.
 *
 * Only booleans, provider names, and status strings are exposed; no credentials,
 * connection strings, or provider error text ever leaves the server.
 */
export async function GET() {
  const database = await probeDatabase();
  const searchConfig = getSearchConfig();
  const isReady = database === 'ok';

  return NextResponse.json(
    {
      status: isReady ? 'ok' : 'degraded',
      service: 'growspace-api',
      timestamp: new Date().toISOString(),
      databaseConfigured: isDatabaseConfigured(),
      database,
      authConfigured: {
        emailDelivery: isEmailConfigured(),
        rateLimiting: isRateLimitConfigured(),
      },
      aiProviders: {
        groqConfigured: Boolean(getGroqApiKey()),
        groqModel: getGroqModel(),
        searchConfigured: Boolean(searchConfig),
        searchProvider: searchConfig?.provider ?? null,
      },
    },
    {
      status: isReady ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

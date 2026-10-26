import { NextResponse, type NextRequest } from 'next/server';
import {
  findCatalogEntryByQuery,
  plantResearchRequestSchema,
} from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { getGroqApiKey } from '@/lib/env';
import { getGroqResearchClient } from '@/lib/research/groq-client';
import { checkResearchRateLimit } from '@/lib/research/rate-limiter';
import { createResearchRecord } from '@/lib/research/research-repository';
import { getSearchAdapter } from '@/lib/research/search-adapter';

export const dynamic = 'force-dynamic';

/**
 * POST /api/plants/research
 * Researches plant cultivation parameters using web search and Groq LLM.
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

    const { plantName } = plantResearchRequestSchema.parse(rawBody);

    // 1. Check existing Plant Library
    const matchedCatalogEntry = findCatalogEntryByQuery(plantName);
    if (matchedCatalogEntry) {
      return NextResponse.json(
        {
          matchedCatalogEntry,
          message: `"${matchedCatalogEntry.commonName}" is already available in the GrowSpace Plant Library.`,
        },
        { status: 200 },
      );
    }

    // 2. Enforce endpoint rate limit for research queries
    const rateLimit = checkResearchRateLimit(user.id);
    if (!rateLimit.allowed) {
      throw new AppError(
        429,
        'rate_limit_exceeded',
        `Too many plant research requests. Please wait ${rateLimit.retryAfterSeconds} seconds before researching again.`,
      );
    }

    // 3. Validate provider configuration
    const groqKey = getGroqApiKey();
    const searchAdapter = getSearchAdapter();

    if (!groqKey || !searchAdapter) {
      const missing: string[] = [];
      if (!groqKey) missing.push('GROQ_API_KEY');
      if (!searchAdapter) missing.push('TAVILY_API_KEY or BRAVE_SEARCH_API_KEY');

      throw new AppError(
        503,
        'setup_required',
        `AI Plant Research requires server configuration (${missing.join(' and ')}). Add the required keys to apps/api/.env.local or the root .env file.`,
      );
    }

    const groqClient = getGroqResearchClient();
    if (!groqClient) {
      throw new AppError(503, 'setup_required', 'Groq client could not be initialized.');
    }

    // 3. Perform web search
    let evidence;
    try {
      evidence = await searchAdapter.search(plantName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Web search failed.';
      if (msg.includes('rate limit')) {
        throw new AppError(429, 'rate_limit_exceeded', msg);
      }
      throw new AppError(502, 'provider_error', `Search provider failed: ${msg}`);
    }

    // 4. Synthesize with Groq LLM
    let profile;
    try {
      profile = await groqClient.synthesizePlantProfile(plantName, evidence);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI synthesis failed.';
      if (msg.includes('rate limit')) {
        throw new AppError(429, 'rate_limit_exceeded', 'Groq API rate limit reached. Please retry in a few moments.');
      }
      throw new AppError(502, 'provider_error', `AI research provider error: ${msg}`);
    }

    // 5. Persist research draft record
    const db = getAuthDb();
    const researchRecord = await createResearchRecord(
      db,
      user.id,
      profile,
      'completed',
    );

    return NextResponse.json(
      {
        researchRecord,
        profile: researchRecord,
        sources: researchRecord.sources,
        confidence: researchRecord.confidence,
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

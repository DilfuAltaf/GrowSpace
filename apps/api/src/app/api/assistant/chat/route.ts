import { NextResponse, type NextRequest } from 'next/server';
import { assistantChatInputSchema } from '@growspace/shared';
import { AppError, errorResponse } from '@/lib/api-error';
import { requireUser } from '@/lib/auth';
import { getAuthDb } from '@/lib/auth/db-provider';
import { checkAssistantRateLimit } from '@/lib/assistant/assistant-rate-limiter';
import {
  addMessageToConversation,
  createConversation,
  findConversationById,
  findMessagesByConversationId,
} from '@/lib/assistant/assistant-repository';
import { assembleAssistantContext } from '@/lib/assistant/assistant-context';
import { performAssistantWebResearch } from '@/lib/assistant/assistant-research';
import { generateAssistantResponse } from '@/lib/assistant/assistant-groq';
import { isValidUuid } from '@/lib/gardens/garden-repository';
import { verifyGardenOwnership } from '@/lib/plants/plant-repository';
import { verifyPlantOwnership } from '@/lib/plant-logs/plant-log-repository';

export const dynamic = 'force-dynamic';

/**
 * POST /api/assistant/chat
 * Primary conversation endpoint for the AI Farming Assistant.
 * Grounded in the user's verified garden, crop, telemetry, and care task context.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request);

    // 1. Rate Limiting Check
    const rateCheck = checkAssistantRateLimit(user.id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          error: {
            code: 'rate_limited',
            message: `Too many assistant requests. Please wait ${rateCheck.retryAfterSeconds} seconds before sending another message.`,
          },
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds),
          },
        },
      );
    }

    // 2. Body Validation
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const parsed = assistantChatInputSchema.safeParse(rawBody);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message ?? 'Invalid request payload';
      throw new AppError(400, 'validation_error', issue);
    }

    const { message, conversationId, gardenId, plantId } = parsed.data;
    const db = getAuthDb();

    // 3. Ownership Verification
    if (gardenId) {
      if (!isValidUuid(gardenId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid garden ID format');
      }
      const gCheck = await verifyGardenOwnership(db, gardenId, user.id);
      if (!gCheck.exists) {
        throw new AppError(404, 'not_found', 'Specified garden does not exist');
      }
      if (!gCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this garden');
      }
    }

    if (plantId) {
      if (!isValidUuid(plantId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid plant ID format');
      }
      const pCheck = await verifyPlantOwnership(db, plantId, user.id);
      if (!pCheck.exists) {
        throw new AppError(404, 'not_found', 'Specified plant does not exist');
      }
      if (!pCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this plant');
      }
    }

    // 4. Conversation Thread Resolution
    let activeConversationId: string;
    if (conversationId) {
      if (!isValidUuid(conversationId)) {
        throw new AppError(400, 'invalid_parameter', 'Invalid conversation ID format');
      }
      const convCheck = await findConversationById(db, conversationId, user.id);
      if (!convCheck.exists) {
        throw new AppError(404, 'not_found', 'Specified conversation does not exist');
      }
      if (!convCheck.owned) {
        throw new AppError(403, 'forbidden', 'You do not have access to this conversation');
      }
      activeConversationId = conversationId;
    } else {
      // Create new conversation thread
      const titleCandidate = message.trim().slice(0, 50);
      const newConv = await createConversation(db, user.id, {
        title: titleCandidate || 'New Conversation',
        gardenId,
        plantId,
      });
      activeConversationId = newConv?.id ?? `session-${Date.now()}`;
    }

    // 5. Retrieve Previous Dialogue History
    const history = await findMessagesByConversationId(db, activeConversationId, { limit: 10 });

    // 6. Assemble Verified Farm Context
    const context = await assembleAssistantContext(db, user.id, {
      gardenId,
      plantId,
      userQuery: message,
    });

    // 7. Optional Targeted Web Research
    const plantNameContext = context.plantFilter?.name;
    const webResearch = await performAssistantWebResearch(message, plantNameContext);

    // 8. Generate Assistant Answer (Groq with Deterministic Fallback)
    const generation = await generateAssistantResponse({
      userQuery: message,
      context,
      history,
      webSources: webResearch.sources,
      webEvidenceText: webResearch.evidenceText,
    });

    // 9. Persist Dialogue Turns (if persistent tables exist)
    await addMessageToConversation(db, activeConversationId, 'user', message, {
      contextGardenId: gardenId ?? null,
      contextPlantId: plantId ?? null,
    });

    const assistantMsg = await addMessageToConversation(
      db,
      activeConversationId,
      'assistant',
      generation.reply,
      {
        sources: webResearch.sources,
        webResearchUsed: generation.webResearchUsed,
        advisoryNotice: generation.advisoryNotice,
        provenanceNotes: generation.provenanceNotes,
      },
    );

    const messageResponse = assistantMsg ?? {
      id: `msg-${Date.now()}`,
      conversationId: activeConversationId,
      role: 'assistant' as const,
      content: generation.reply,
      metadata: {
        sources: webResearch.sources,
        webResearchUsed: generation.webResearchUsed,
        advisoryNotice: generation.advisoryNotice,
        provenanceNotes: generation.provenanceNotes,
      },
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({
      conversationId: activeConversationId,
      message: messageResponse,
      sources: webResearch.sources,
      advisoryNotice: generation.advisoryNotice,
      groundingDetails: {
        gardensCount: context.gardensCount,
        plantsCount: context.plantsCount,
        readingsCount: context.readingsCount,
        tasksCount: context.tasksCount,
        webResearchUsed: generation.webResearchUsed,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

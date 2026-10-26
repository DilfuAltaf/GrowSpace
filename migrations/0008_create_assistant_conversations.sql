-- Migration: 0008_create_assistant_conversations
-- Description: Creates assistant_conversations and assistant_messages tables for AI Farming Assistant
-- Target: PostgreSQL 15+ (Neon / PGlite)
-- Dependencies: 0001_create_auth_tables (users), 0003_create_gardens_and_plants (gardens, plants)

-- ============================================================================
-- 1. ASSISTANT_CONVERSATIONS
-- Conversation threads between users and the AI Farming Assistant
-- ============================================================================
CREATE TABLE IF NOT EXISTS assistant_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    title TEXT NOT NULL,
    garden_id UUID NULL,
    plant_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT assistant_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT assistant_conversations_garden_fkey FOREIGN KEY (garden_id, user_id) REFERENCES gardens(id, user_id) ON DELETE SET NULL (garden_id),
    CONSTRAINT assistant_conversations_plant_fkey FOREIGN KEY (plant_id, user_id) REFERENCES plants(id, user_id) ON DELETE SET NULL (plant_id),
    CONSTRAINT assistant_conversations_title_length_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 200)
);

COMMENT ON TABLE assistant_conversations IS 'User conversation threads with the AI Farming Assistant';
COMMENT ON COLUMN assistant_conversations.id IS 'Unique conversation thread identifier (UUID v4)';
COMMENT ON COLUMN assistant_conversations.user_id IS 'Owner of the conversation thread; cascades upon user deletion';
COMMENT ON COLUMN assistant_conversations.title IS 'Summary title of the conversation topic';
COMMENT ON COLUMN assistant_conversations.garden_id IS 'Optional garden context filter; nullified on garden deletion';
COMMENT ON COLUMN assistant_conversations.plant_id IS 'Optional plant context filter; nullified on plant deletion';

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user_updated
    ON assistant_conversations(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_garden
    ON assistant_conversations(garden_id) WHERE garden_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_plant
    ON assistant_conversations(plant_id) WHERE plant_id IS NOT NULL;

-- ============================================================================
-- 2. ASSISTANT_MESSAGES
-- Individual dialogue turns (user queries and assistant responses)
-- ============================================================================
CREATE TABLE IF NOT EXISTS assistant_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT assistant_messages_conversation_fkey FOREIGN KEY (conversation_id) REFERENCES assistant_conversations(id) ON DELETE CASCADE,
    CONSTRAINT assistant_messages_role_check CHECK (role IN ('user', 'assistant')),
    CONSTRAINT assistant_messages_content_check CHECK (char_length(btrim(content)) >= 1)
);

COMMENT ON TABLE assistant_messages IS 'Ordered messages within an AI Farming Assistant conversation';
COMMENT ON COLUMN assistant_messages.conversation_id IS 'Parent conversation thread; cascades upon conversation deletion';
COMMENT ON COLUMN assistant_messages.role IS 'Message speaker role: user or assistant';
COMMENT ON COLUMN assistant_messages.content IS 'The plaintext content of the message turn';
COMMENT ON COLUMN assistant_messages.metadata IS 'Structured metadata: web citations, telemetry provenance, and context snapshot';

CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_created
    ON assistant_messages(conversation_id, created_at ASC);

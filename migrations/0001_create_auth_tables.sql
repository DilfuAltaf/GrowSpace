-- Migration: 0001_create_auth_tables
-- Description: Creates core identity, session, token, and rate-limiting tables for first-party authentication
-- Target: PostgreSQL 15+ (Neon)
-- Dependencies: None (base identity layer)

-- ============================================================================
-- 1. USERS
-- Internal application user identity and profile preferences.
-- Requires an email and Argon2id password hash for every account.
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NULL,
    temperature_unit TEXT NOT NULL DEFAULT 'celsius',
    email_verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT users_email_key UNIQUE (email),
    CONSTRAINT users_email_normalized_check CHECK (email = lower(btrim(email))),
    CONSTRAINT users_email_length_check CHECK (char_length(email) BETWEEN 3 AND 254),
    CONSTRAINT users_email_shape_check CHECK (position('@' IN email) > 1 AND strpos(email, '@') < char_length(email)),
    CONSTRAINT users_password_hash_format_check CHECK (password_hash LIKE '$argon2id$%'),
    CONSTRAINT users_display_name_length_check CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 80),
    CONSTRAINT users_temperature_unit_check CHECK (temperature_unit IN ('celsius', 'fahrenheit'))
);

COMMENT ON TABLE users IS 'Application user identity and profile preferences; ownership root of all private data';
COMMENT ON COLUMN users.id IS 'Internal unique user identifier (UUID v4)';
COMMENT ON COLUMN users.email IS 'Normalized (lowercase, trimmed) unique email address';
COMMENT ON COLUMN users.password_hash IS 'Argon2id encoded password hash ($argon2id$...); required for every registered account';
COMMENT ON COLUMN users.display_name IS 'Optional public display name (1-80 characters)';
COMMENT ON COLUMN users.temperature_unit IS 'Preferred temperature display unit (celsius or fahrenheit)';
COMMENT ON COLUMN users.email_verified_at IS 'Timestamp when email ownership was confirmed; NULL if unverified';

-- ============================================================================
-- 2. SESSIONS
-- Server-managed opaque sessions stored via SHA-256 token hashes.
-- Raw tokens are sent only via HttpOnly cookies and never stored.
-- ============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    token_hash BYTEA NOT NULL,
    csrf_token_hash BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,

    -- Constraints
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT sessions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT sessions_token_hash_length_check CHECK (octet_length(token_hash) = 32),
    CONSTRAINT sessions_csrf_token_hash_length_check CHECK (octet_length(csrf_token_hash) = 32),
    CONSTRAINT sessions_expires_at_check CHECK (expires_at > created_at),
    CONSTRAINT sessions_last_used_at_check CHECK (last_used_at >= created_at),
    CONSTRAINT sessions_revoked_at_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

COMMENT ON TABLE sessions IS 'Active and revoked server sessions; stores only SHA-256 digests of opaque session/CSRF tokens';
COMMENT ON COLUMN sessions.token_hash IS 'Binary SHA-256 digest (32 bytes) of the client session cookie token';
COMMENT ON COLUMN sessions.csrf_token_hash IS 'Binary SHA-256 digest (32 bytes) of the session-bound CSRF token';
COMMENT ON COLUMN sessions.expires_at IS 'Absolute session expiry timestamp (default 7 days from creation)';
COMMENT ON COLUMN sessions.last_used_at IS 'Timestamp of recent session activity (throttled to at most once per 5 min)';
COMMENT ON COLUMN sessions.revoked_at IS 'Timestamp of explicit logout or revocation; non-null indicates revoked session';

-- Indexes for session management, lookup, and background cleanup
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS sessions_revoked_at_idx ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;

-- ============================================================================
-- 3. AUTH_TOKENS
-- Single-use hashed tokens for email verification and password reset.
-- Raw tokens are sent via email link fragment and never stored.
-- ============================================================================
CREATE TABLE IF NOT EXISTS auth_tokens (
    id UUID DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    purpose TEXT NOT NULL,
    token_hash BYTEA NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT auth_tokens_pkey PRIMARY KEY (id),
    CONSTRAINT auth_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT auth_tokens_purpose_check CHECK (purpose IN ('email_verification', 'password_reset')),
    CONSTRAINT auth_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT auth_tokens_token_hash_length_check CHECK (octet_length(token_hash) = 32),
    CONSTRAINT auth_tokens_expires_at_check CHECK (expires_at > created_at),
    CONSTRAINT auth_tokens_consumed_at_check CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

COMMENT ON TABLE auth_tokens IS 'Single-use cryptographic token hashes for verification and recovery';
COMMENT ON COLUMN auth_tokens.purpose IS 'Token purpose (email_verification or password_reset)';
COMMENT ON COLUMN auth_tokens.token_hash IS 'Binary SHA-256 digest (32 bytes) of the single-use token';
COMMENT ON COLUMN auth_tokens.expires_at IS 'Token expiration timestamp (24h for verification, 30m for reset)';
COMMENT ON COLUMN auth_tokens.consumed_at IS 'Timestamp of atomic consumption; non-null indicates already used';

-- Indexes for token validation, active token lookups, and cleanup
CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_expires_idx ON auth_tokens(user_id, purpose, expires_at);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_at_idx ON auth_tokens(expires_at);
-- Partial index supporting lookup and transactional invalidation of active tokens.
-- Defined as non-unique so expired, unconsumed tokens cannot block replacement tokens.
-- Application logic invalidates previous active tokens within the issuance transaction:
--   UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose = $2 AND consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_active_idx ON auth_tokens(user_id, purpose) WHERE consumed_at IS NULL;

-- ============================================================================
-- 4. AUTH_RATE_LIMITS
-- Operational security table tracking rate-limit counters by HMAC-SHA-256 keys.
-- Does not store raw IP addresses or email addresses to protect privacy.
-- ============================================================================
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash BYTEA NOT NULL,
    action TEXT NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    blocked_until TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Constraints
    CONSTRAINT auth_rate_limits_pkey PRIMARY KEY (key_hash),
    CONSTRAINT auth_rate_limits_key_hash_length_check CHECK (octet_length(key_hash) = 32),
    CONSTRAINT auth_rate_limits_action_check CHECK (action IN ('login', 'register', 'password_reset', 'verify_resend')),
    CONSTRAINT auth_rate_limits_attempt_count_check CHECK (attempt_count >= 0)
);

COMMENT ON TABLE auth_rate_limits IS 'Rate limiting counters keyed by server-side HMAC-SHA-256 digests';
COMMENT ON COLUMN auth_rate_limits.key_hash IS 'Binary HMAC-SHA-256 digest (32 bytes) of action + scope + identifier';
COMMENT ON COLUMN auth_rate_limits.action IS 'Rate-limited action type';
COMMENT ON COLUMN auth_rate_limits.attempt_count IS 'Number of attempts recorded in the current active window';
COMMENT ON COLUMN auth_rate_limits.blocked_until IS 'Timestamp until which requests matching key_hash are throttled';

-- Indexes for rate-limit window cleanup and expiry queries
CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_at_idx ON auth_rate_limits(updated_at);
CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_until_idx ON auth_rate_limits(blocked_until) WHERE blocked_until IS NOT NULL;

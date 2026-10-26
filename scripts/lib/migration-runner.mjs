import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Migration Runner Key Constants
 */
export const ADVISORY_LOCK_KEY = 73928194; // 32-bit signed int for pg advisory lock

/**
 * Expected 16 Application Domain Tables (Post-Migration 0008)
 */
export const EXPECTED_APPLICATION_TABLES = [
  'assistant_conversations',
  'assistant_messages',
  'auth_rate_limits',
  'auth_tokens',
  'care_schedules',
  'care_tasks',
  'gardens',
  'notifications',
  'plant_catalog',
  'plant_catalog_reference_ranges',
  'plant_logs',
  'plant_research_records',
  'plants',
  'sensor_readings',
  'sessions',
  'users',
];

/**
 * Expected constraint inventory for the post-0008 schema.
 * Recompute these whenever a migration adds or removes constraints:
 *   SELECT contype, count(*) FROM pg_constraint
 *   WHERE connamespace = 'public'::regnamespace GROUP BY contype;
 */
export const EXPECTED_CONSTRAINT_COUNTS = {
  foreignKeys: 26,
  unique: 7,
  checks: 75,
};

/**
 * Expected Primary Key Column Definitions for All Application Tables
 */
export const EXPECTED_PRIMARY_KEYS = {
  assistant_conversations: ['id'],
  assistant_messages: ['id'],
  auth_rate_limits: ['key_hash'],
  auth_tokens: ['id'],
  care_schedules: ['id'],
  care_tasks: ['id'],
  gardens: ['id'],
  notifications: ['id'],
  plant_catalog: ['id'],
  plant_catalog_reference_ranges: ['plant_catalog_id', 'measurement_type'],
  plant_logs: ['id'],
  plant_research_records: ['id'],
  plants: ['id'],
  sensor_readings: ['id'],
  sessions: ['id'],
  users: ['id'],
};

/**
 * Audited Baseline SHA-256 Checksums for Migrations
 */
export const AUDITED_BASELINE_CHECKSUMS = {
  '0001': '8098c865b05bf58b3693c1eb47154c0599523fbc01ce212693a83253b7af8661',
  '0002': '9e4aa4945798b295abee1efea053f70d942ac00426331425163e65a8f92716b1',
  '0003': '2c055f0d753faf3f8f08b29bc946d2f6323bb18d11c2134601568faa065a49cd',
  '0004': '6bc86c4b6233487410808039dad4f9e2ae439aeeeed1fbea72fc4af8cba64594',
  '0005': 'b8f76021ed5f379af2db9c6d263a1f245c8d6d9555514c876fea30ab1ea45e91',
  '0006': 'e4fa61ef97a5bc0dda792f58b97a4480b1baf9fc93103603f1e3fd9f8b21c0b7',
  '0007': 'b1c672f5d04828fd3f958ac13546799ce5fbda12d4e6cece23b3548a3526aa63',
  '0008': '16d12679c2324b231c6bc64e7fad353bff5c321f28bf4b35fb1867dceec2f965',
};

/**
 * Computes canonical SHA-256 checksum for a migration file.
 * Normalizes Windows CRLF (\r\n) to Unix LF (\n) to ensure cross-platform hash determinism.
 *
 * @param {string} content - Raw file text
 * @returns {string} - 64-character lowercase hex SHA-256 digest
 */
export function computeCanonicalChecksum(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Executes a multi-statement SQL script using client.exec if available (e.g. PGlite),
 * or client.query (e.g. @neondatabase/serverless or pg).
 */
export async function executeSql(client, sql) {
  if (typeof client.exec === 'function') {
    await client.exec(sql);
  } else {
    await client.query(sql);
  }
}

/**
 * Discovers and validates migration files in the given directory.
 * Enforces strict numerical naming convention: ^(\d{4})_.*\.sql$
 * Rejects duplicate versions.
 *
 * @param {string} migrationsDir - Absolute or relative path to migrations directory
 * @param {object} [fsModule] - Optional filesystem mock for testing
 * @returns {Array<{version: string, name: string, fullPath: string, checksum: string, sql: string}>}
 */
export function discoverMigrationFiles(migrationsDir, fsModule = { readdirSync, readFileSync }) {
  const files = fsModule.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const migrations = [];
  const seenVersions = new Map();

  for (const file of files) {
    const match = file.match(/^(\d{4})_(.+)\.sql$/);
    if (!match) {
      throw new Error(`Invalid migration filename: "${file}". Filename must match pattern ^(\\d{4})_.*\\.sql$`);
    }

    const version = match[1];
    if (seenVersions.has(version)) {
      throw new Error(
        `Duplicate migration version detected: "${version}". ` +
        `Conflicting files: "${seenVersions.get(version)}" and "${file}"`
      );
    }
    seenVersions.set(version, file);

    const fullPath = join(migrationsDir, file);
    const sql = fsModule.readFileSync(fullPath, 'utf8');
    const checksum = computeCanonicalChecksum(sql);

    migrations.push({
      version,
      name: file,
      fullPath,
      checksum,
      sql,
    });
  }

  // Ensure numerical sorting by version string
  migrations.sort((a, b) => a.version.localeCompare(b.version));
  return migrations;
}

/**
 * Ensures the migration history table exists in the target database.
 *
 * @param {object} client - Database client with query() method
 */
export async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      applied_by TEXT NOT NULL,
      execution_time_ms INTEGER NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/**
 * Fetches all applied migration records from _schema_migrations.
 *
 * @param {object} client - Database client
 * @returns {Promise<Array<{version: string, name: string, checksum: string, applied_at: Date}>>}
 */
export async function fetchMigrationHistory(client) {
  const res = await client.query(`
    SELECT version, name, checksum, applied_at
    FROM _schema_migrations
    ORDER BY version ASC;
  `);
  return res.rows || [];
}

/**
 * Core Migration Runner Engine
 *
 * @param {object} options
 * @param {object} options.client - Connected database client supporting query()
 * @param {string} options.migrationsDir - Directory containing .sql migration files
 * @param {object} [options.fsModule] - Optional fs dependency injection for unit tests
 * @param {object} [options.logger] - Optional logger interface
 * @returns {Promise<{appliedCount: number, appliedVersions: string[]}>}
 */
export async function runMigrations({
  client,
  migrationsDir,
  fsModule = { readdirSync, readFileSync },
  logger = console,
}) {
  logger.log('--- GrowSpace Migration Runner ---');

  // Step 1: Acquire Concurrency Advisory Lock
  logger.log('Acquiring migration advisory lock...');
  const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired;', [ADVISORY_LOCK_KEY]);
  const acquired = Boolean(lockRes.rows?.[0]?.acquired);
  if (!acquired) {
    throw new Error(
      'CONCURRENCY LOCK FAILURE: Another migration runner is currently running (advisory lock held). Halting.'
    );
  }

  try {
    // Step 2: Discover and validate local migration files
    const localMigrations = discoverMigrationFiles(migrationsDir, fsModule);
    logger.log(`Discovered ${localMigrations.length} local migration file(s).`);

    // Step 3: Ensure history table exists
    await ensureMigrationTable(client);

    // Step 4: Fetch history
    const history = await fetchMigrationHistory(client);
    const appliedMap = new Map(history.map((h) => [h.version, h]));
    const maxAppliedVersion = history.length > 0 ? history[history.length - 1].version : null;

    logger.log(`Found ${history.length} previously applied migration(s) in _schema_migrations.`);

    // Step 5: Verify Checksums of all previously applied migrations (Drift Check)
    for (const applied of history) {
      const local = localMigrations.find((m) => m.version === applied.version);
      if (!local) {
        throw new Error(
          `CRITICAL DRIFT: Previously applied migration "${applied.version}" (${applied.name}) ` +
          `is missing from repository!`
        );
      }
      if (local.checksum !== applied.checksum) {
        throw new Error(
          `CRITICAL CHECKSUM DRIFT: Migration "${applied.version}" (${applied.name}) has been modified!\n` +
          `  Recorded in DB : ${applied.checksum}\n` +
          `  Local working  : ${local.checksum}\n` +
          `Migrations are immutable. Altering applied migrations is prohibited.`
        );
      }
    }

    // Step 6: Identify Pending Migrations & Assert Monotonic Ordering
    const pending = [];
    for (const local of localMigrations) {
      if (!appliedMap.has(local.version)) {
        if (maxAppliedVersion && local.version < maxAppliedVersion) {
          throw new Error(
            `OUT-OF-ORDER MIGRATION: Migration "${local.version}" (${local.name}) has not been applied, ` +
            `but newer migration "${maxAppliedVersion}" has already executed. Halting.`
          );
        }
        pending.push(local);
      }
    }

    if (pending.length === 0) {
      logger.log('Database is up to date. Zero pending migrations.');
      return { appliedCount: 0, appliedVersions: [] };
    }

    logger.log(`Executing ${pending.length} pending migration(s) in individual transactions...`);
    const appliedVersions = [];

    // Step 7: Apply each pending migration in its own atomic transaction
    for (const migration of pending) {
      logger.log(`Applying ${migration.version}: ${migration.name}...`);
      const startTime = Date.now();

      try {
        await client.query('BEGIN;');
        // Enforce transaction-scoped lock as defense-in-depth
        await client.query('SELECT pg_advisory_xact_lock($1);', [ADVISORY_LOCK_KEY]);

        // Execute migration DDL
        await executeSql(client, migration.sql);

        // Record history entry
        const durationMs = Date.now() - startTime;
        await client.query(
          `INSERT INTO _schema_migrations (version, name, checksum, applied_by, execution_time_ms)
           VALUES ($1, $2, $3, current_user, $4);`,
          [migration.version, migration.name, migration.checksum, durationMs]
        );

        await client.query('COMMIT;');
        appliedVersions.push(migration.version);
        logger.log(`  ✓ ${migration.name} successfully applied in ${durationMs}ms`);
      } catch (err) {
        await client.query('ROLLBACK;');
        logger.error(`  ✗ FAILED executing migration ${migration.name}. Transaction rolled back.`);
        throw new Error(`Migration ${migration.name} failed: ${err.message || err}`);
      }
    }

    logger.log(`All ${appliedVersions.length} migration(s) successfully applied.`);
    return { appliedCount: appliedVersions.length, appliedVersions };

  } finally {
    // Always release session advisory lock
    try {
      await client.query('SELECT pg_advisory_unlock($1);', [ADVISORY_LOCK_KEY]);
    } catch (unlockErr) {
      logger.error('Failed to release advisory lock:', unlockErr.message || unlockErr);
    }
  }
}

/**
 * Validates Application Domain Schema Parity against docs/database/schema.md
 * (Verifies all 16 application tables, PKs, FKs, constraints, and partial indexes)
 *
 * @param {object} client - Database client
 * @param {object} [logger] - Logger interface
 * @returns {Promise<{success: boolean, errors: string[]}>}
 */
export async function verifyApplicationSchema(client, logger = console) {
  const errors = [];

  // 1. Table inventory check (exact 11 application domain tables)
  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  const actualTables = tablesRes.rows.map((r) => r.table_name);
  const tableNames = new Set(actualTables);
  const missingTables = EXPECTED_APPLICATION_TABLES.filter((t) => !tableNames.has(t));
  const unexpectedTables = actualTables.filter(
    (t) => t !== '_schema_migrations' && !EXPECTED_APPLICATION_TABLES.includes(t)
  );

  if (missingTables.length > 0) {
    errors.push(`Missing application tables: ${missingTables.join(', ')}`);
  }
  if (unexpectedTables.length > 0) {
    errors.push(`Unexpected tables in public schema: ${unexpectedTables.join(', ')}`);
  }
  if (missingTables.length === 0 && unexpectedTables.length === 0) {
    logger.log(`✓ Table Inventory: Exact inventory of ${EXPECTED_APPLICATION_TABLES.length} application tables present.`);
  }

  // 2. Primary Key column definition verification
  const pkRes = await client.query(`
    SELECT 
      c.relname AS table_name,
      con.conname AS pk_name,
      array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) AS pk_columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
    WHERE n.nspname = 'public' AND con.contype = 'p' AND c.relname <> '_schema_migrations'
    GROUP BY c.relname, con.conname
    ORDER BY c.relname;
  `);
  const pkMap = new Map(
    pkRes.rows.map((r) => {
      let cols = r.pk_columns;
      if (typeof cols === 'string') {
        cols = cols
          .replace(/^\{|\}$/g, '')
          .split(',')
          .map((s) => s.replace(/^"|"$/g, '').trim())
          .filter(Boolean);
      }
      return [r.table_name, cols];
    }),
  );
  let pkOk = true;
  for (const table of EXPECTED_APPLICATION_TABLES) {
    const cols = pkMap.get(table);
    const expectedCols = EXPECTED_PRIMARY_KEYS[table];
    if (!cols) {
      errors.push(`Table "${table}" is missing a primary key constraint.`);
      pkOk = false;
    } else if (JSON.stringify(cols) !== JSON.stringify(expectedCols)) {
      errors.push(`Table "${table}" primary key columns mismatch: expected [${expectedCols.join(', ')}], got [${cols.join(', ')}]`);
      pkOk = false;
    }
  }
  if (pkOk) {
    logger.log('✓ Primary Keys: Every application table has verified primary key column definitions.');
  }

  // 3. Composite Foreign Keys & Column-Specific ON DELETE SET NULL
  const columnSpecificSetNull = new Map([
    ['sensor_readings_plant_owner_fkey', '(plant_id, garden_id, user_id)'],
    ['care_tasks_plant_owner_fkey', '(plant_id, garden_id, user_id)'],
    ['care_schedules_plant_owner_fkey', '(plant_id, garden_id, user_id)'],
    ['assistant_conversations_plant_fkey', '(plant_id, user_id)'],
    ['assistant_conversations_garden_fkey', '(garden_id, user_id)'],
  ]);
  const fkRes = await client.query(`
    SELECT 
      conname,
      confdeltype,
      pg_get_constraintdef(oid) AS def
    FROM pg_constraint 
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace
      AND conname = ANY($1::text[]);
  `, [[...columnSpecificSetNull.keys()]]);
  const setNullOk =
    fkRes.rows.length === columnSpecificSetNull.size &&
    fkRes.rows.every((r) => {
      const expectedColumns = columnSpecificSetNull.get(r.conname);
      return r.confdeltype === 'n' && expectedColumns && r.def.includes(expectedColumns);
    });
  if (setNullOk) {
    logger.log(
      `✓ Column-Specific FK Cascades: Verified ON DELETE SET NULL on ${columnSpecificSetNull.size} composite foreign keys.`,
    );
  } else {
    errors.push('Column-specific FK cascade verification failed for composite SET NULL foreign keys.');
  }

  // Foreign key count verification
  const totalFkRes = await client.query(`
    SELECT count(*)::int AS fk_count
    FROM pg_constraint 
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace;
  `);
  if (totalFkRes.rows[0]?.fk_count === EXPECTED_CONSTRAINT_COUNTS.foreignKeys) {
    logger.log(
      `✓ Foreign Key Inventory: All ${EXPECTED_CONSTRAINT_COUNTS.foreignKeys} foreign key constraints present.`,
    );
  } else {
    errors.push(
      `Foreign key count mismatch: expected ${EXPECTED_CONSTRAINT_COUNTS.foreignKeys}, got ${totalFkRes.rows[0]?.fk_count}`,
    );
  }

  // 4. Unique constraints count verification
  const totalUqRes = await client.query(`
    SELECT count(*)::int AS uq_count
    FROM pg_constraint 
    WHERE contype = 'u' AND connamespace = 'public'::regnamespace;
  `);
  if (totalUqRes.rows[0]?.uq_count === EXPECTED_CONSTRAINT_COUNTS.unique) {
    logger.log(
      `✓ Unique Constraints: All ${EXPECTED_CONSTRAINT_COUNTS.unique} explicit unique constraints present.`,
    );
  } else {
    errors.push(
      `Unique constraint count mismatch: expected ${EXPECTED_CONSTRAINT_COUNTS.unique}, got ${totalUqRes.rows[0]?.uq_count}`,
    );
  }

  // 5. Security Digest and Check Constraints (verifying expressions, not just names)
  const checkRes = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint 
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace
      AND conname IN (
        'users_password_hash_format_check',
        'sessions_token_hash_length_check',
        'sessions_csrf_token_hash_length_check',
        'auth_tokens_token_hash_length_check',
        'auth_rate_limits_key_hash_length_check',
        'care_tasks_completed_at_consistency_check'
      );
  `);
  const checkMap = new Map(checkRes.rows.map((r) => [r.conname, r.def]));
  const requiredChecks = [
    ['users_password_hash_format_check', '$argon2id$%'],
    ['sessions_token_hash_length_check', 'octet_length(token_hash) = 32'],
    ['sessions_csrf_token_hash_length_check', 'octet_length(csrf_token_hash) = 32'],
    ['auth_tokens_token_hash_length_check', 'octet_length(token_hash) = 32'],
    ['auth_rate_limits_key_hash_length_check', 'octet_length(key_hash) = 32'],
    ['care_tasks_completed_at_consistency_check', 'completed'],
  ];

  let checksOk = true;
  for (const [name, token] of requiredChecks) {
    const def = checkMap.get(name);
    if (!def || !def.includes(token)) {
      errors.push(`Check constraint ${name} missing or invalid expression: ${def}`);
      checksOk = false;
    }
  }

  const totalCkRes = await client.query(`
    SELECT count(*)::int AS ck_count
    FROM pg_constraint 
    WHERE contype = 'c' AND connamespace = 'public'::regnamespace;
  `);
  if (totalCkRes.rows[0]?.ck_count !== EXPECTED_CONSTRAINT_COUNTS.checks) {
    errors.push(
      `Check constraint count mismatch: expected ${EXPECTED_CONSTRAINT_COUNTS.checks}, got ${totalCkRes.rows[0]?.ck_count}`,
    );
    checksOk = false;
  }

  if (checksOk) {
    logger.log(
      `✓ Security & Check Constraints: All ${EXPECTED_CONSTRAINT_COUNTS.checks} constraints and 6 critical integrity expressions verified.`,
    );
  }

  // 6. Partial Indexes (verifying predicates, not just index names)
  const idxRes = await client.query(`
    SELECT indexname, indexdef 
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND indexname IN (
        'auth_tokens_user_purpose_active_idx',
        'sessions_revoked_at_idx',
        'sensor_readings_plant_recorded_at_idx',
        'care_tasks_plant_due_at_idx',
        'care_schedules_plant_idx',
        'care_tasks_schedule_id_idx',
        'idx_assistant_conversations_garden',
        'idx_assistant_conversations_plant'
      );
  `);
  const idxMap = new Map(idxRes.rows.map((r) => [r.indexname, r.indexdef]));
  const requiredIndexes = [
    ['auth_tokens_user_purpose_active_idx', 'WHERE (consumed_at IS NULL)'],
    ['sessions_revoked_at_idx', 'WHERE (revoked_at IS NOT NULL)'],
    ['sensor_readings_plant_recorded_at_idx', 'WHERE (plant_id IS NOT NULL)'],
    ['care_tasks_plant_due_at_idx', 'WHERE (plant_id IS NOT NULL)'],
    ['care_schedules_plant_idx', 'WHERE (plant_id IS NOT NULL)'],
    ['care_tasks_schedule_id_idx', 'WHERE (schedule_id IS NOT NULL)'],
    ['idx_assistant_conversations_garden', 'WHERE (garden_id IS NOT NULL)'],
    ['idx_assistant_conversations_plant', 'WHERE (plant_id IS NOT NULL)'],
  ];

  let indexesOk = true;
  for (const [name, predicate] of requiredIndexes) {
    const def = idxMap.get(name);
    if (!def || !def.includes(predicate)) {
      errors.push(`Partial index ${name} missing or invalid predicate: ${def}`);
      indexesOk = false;
    }
  }
  if (indexesOk) {
    logger.log(
      `✓ Partial Indexes: Verified ${requiredIndexes.length} partial indexes with active WHERE clauses.`,
    );
  }

  return { success: errors.length === 0, errors };
}

/**
 * Validates Migration History Ledger in _schema_migrations
 *
 * @param {object} client - Database client
 * @param {object} [logger] - Logger interface
 * @param {Record<string, string>} [expectedChecksums] - Map of version to expected SHA-256
 * @returns {Promise<{success: boolean, errors: string[]}>}
 */
export async function verifyMigrationHistory(
  client,
  logger = console,
  expectedChecksums = AUDITED_BASELINE_CHECKSUMS
) {
  const errors = [];

  const tableRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = '_schema_migrations';
  `);
  if (tableRes.rows.length === 0) {
    errors.push('Migration history table _schema_migrations does not exist.');
    return { success: false, errors };
  }

  const rowsRes = await client.query(`
    SELECT version, name, checksum 
    FROM _schema_migrations 
    ORDER BY version ASC;
  `);

  const expectedVersions = Object.keys(expectedChecksums).sort();
  const recordedVersions = rowsRes.rows.map((r) => r.version);

  const missing = expectedVersions.filter((v) => !recordedVersions.includes(v));
  if (missing.length > 0) {
    errors.push(`Missing recorded migration versions: ${missing.join(', ')}`);
  }

  const unexpected = recordedVersions.filter((v) => !expectedVersions.includes(v));
  if (unexpected.length > 0) {
    errors.push(`Unexpected recorded migration versions: ${unexpected.join(', ')}`);
  }

  let checksumsOk = true;
  for (const row of rowsRes.rows) {
    const expected = expectedChecksums[row.version];
    if (expected && row.checksum !== expected) {
      errors.push(
        `Checksum mismatch for version ${row.version} (${row.name}): ` +
        `expected ${expected}, recorded ${row.checksum}`
      );
      checksumsOk = false;
    }
  }

  if (missing.length === 0 && unexpected.length === 0 && checksumsOk) {
    logger.log(
      `✓ Migration History: All ${expectedVersions.length} version records and cryptographic checksums verified in _schema_migrations.`,
    );
  }

  return { success: errors.length === 0, errors };
}

/**
 * High-level Postflight Verification Engine
 *
 * @param {object} client - Database client
 * @param {object} [options]
 * @param {boolean} [options.requireHistory=true] - Whether _schema_migrations must exist and be verified
 * @param {object} [options.logger] - Logger interface
 */
export async function runPostflightVerification(client, { requireHistory = true, logger = console } = {}) {
  logger.log('\n--- Running Schema Parity Verification ---');

  const appResult = await verifyApplicationSchema(client, logger);
  if (!appResult.success) {
    logger.error('✗ Application Schema Verification FAILED:');
    for (const err of appResult.errors) logger.error(`  - ${err}`);
    throw new Error('Application schema verification failed.');
  }

  if (requireHistory) {
    const historyResult = await verifyMigrationHistory(client, logger);
    if (!historyResult.success) {
      logger.error('✗ Migration History Verification FAILED:');
      for (const err of historyResult.errors) logger.error(`  - ${err}`);
      throw new Error('Migration history verification failed.');
    }
  } else {
    logger.log('ℹ Skipping migration history verification (--app-only mode).');
  }

  logger.log('✓ All verification checks PASSED.\n');
}

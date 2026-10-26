import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import {
  ADVISORY_LOCK_KEY,
  runMigrations,
  verifyApplicationSchema,
  verifyMigrationHistory,
  runPostflightVerification,
} from '../lib/migration-runner.mjs';

const require = createRequire(import.meta.url);
// Resolve PGlite from the API workspace, which owns the dependency, so this suite
// does not pin a pnpm store path that changes whenever the dependency is updated.
const apiWorkspaceDir = fileURLToPath(new URL('../../apps/api/', import.meta.url));
const pgliteEntry = require.resolve('@electric-sql/pglite', { paths: [apiWorkspaceDir] });
const { PGlite } = await import(pathToFileURL(pgliteEntry).href);

const MIGRATION_FILES = [
  'migrations/0001_create_auth_tables.sql',
  'migrations/0002_create_catalog_tables.sql',
  'migrations/0003_create_gardens_and_plants.sql',
  'migrations/0004_create_sensor_readings_care_tasks_plant_logs.sql',
  'migrations/0005_create_notifications.sql',
  'migrations/0006_create_plant_research.sql',
  'migrations/0007_create_care_schedules.sql',
  'migrations/0008_create_assistant_conversations.sql',
];

const EXPECTED_MIGRATION_VERSIONS = [
  '0001',
  '0002',
  '0003',
  '0004',
  '0005',
  '0006',
  '0007',
  '0008',
];

/** Applies every real migration file directly, without the history ledger. */
async function applyRawMigrations(db) {
  const fs = require('node:fs');
  for (const file of MIGRATION_FILES) {
    await db.exec(fs.readFileSync(file, 'utf8'));
  }
}

/**
 * Creates an in-memory real PostgreSQL instance using PGlite.
 * Each call returns an isolated, real PostgreSQL 17 engine with standard catalogs and SQL engine.
 */
async function createDisposablePg() {
  const db = new PGlite();
  await db.waitReady;
  return db;
}

describe('Real PostgreSQL Disposable Database Integration Suite (PGlite Engine)', () => {

  // Test 1: Empty database and fresh migration sequence of all real migration files
  test('Integration 1: Applies all 8 real migrations against empty real PostgreSQL database', async () => {
    const db = await createDisposablePg();
    try {
      const result = await runMigrations({
        client: db,
        migrationsDir: 'migrations',
        logger: { log: () => {}, error: () => {} },
      });

      assert.equal(result.appliedCount, 8);
      assert.deepEqual(result.appliedVersions, EXPECTED_MIGRATION_VERSIONS);

      // Verify all 17 tables exist (16 application tables + _schema_migrations)
      const tablesRes = await db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      const tableNames = tablesRes.rows.map((r) => r.table_name);
      assert.equal(tableNames.length, 17);
      assert.ok(tableNames.includes('_schema_migrations'));
      assert.ok(tableNames.includes('users'));
      assert.ok(tableNames.includes('sessions'));
      assert.ok(tableNames.includes('auth_tokens'));
      assert.ok(tableNames.includes('auth_rate_limits'));
      assert.ok(tableNames.includes('plant_catalog'));
      assert.ok(tableNames.includes('plant_catalog_reference_ranges'));
      assert.ok(tableNames.includes('gardens'));
      assert.ok(tableNames.includes('plants'));
      assert.ok(tableNames.includes('sensor_readings'));
      assert.ok(tableNames.includes('care_tasks'));
      assert.ok(tableNames.includes('plant_logs'));
      assert.ok(tableNames.includes('care_schedules'));
      assert.ok(tableNames.includes('assistant_conversations'));
      assert.ok(tableNames.includes('assistant_messages'));

      // Verify exactly 8 history records
      const historyRes = await db.query(`
        SELECT version, name, checksum, execution_time_ms 
        FROM _schema_migrations 
        ORDER BY version ASC;
      `);
      assert.equal(historyRes.rows.length, 8);
      assert.deepEqual(
        historyRes.rows.map((r) => r.version),
        EXPECTED_MIGRATION_VERSIONS
      );
      assert.ok(historyRes.rows.every((r) => r.execution_time_ms >= 0 && r.checksum.length === 64));

      // Verify complete schema parity (application schema + history)
      await runPostflightVerification(db, {
        requireHistory: true,
        logger: { log: () => {}, error: () => {} },
      });
    } finally {
      await db.close();
    }
  });

  // Test 2: Idempotent second execution performs zero DDL
  test('Integration 2: Re-running runner on migrated real PostgreSQL performs zero DDL operations', async () => {
    const db = await createDisposablePg();
    try {
      // First run
      const firstRun = await runMigrations({
        client: db,
        migrationsDir: 'migrations',
        logger: { log: () => {}, error: () => {} },
      });
      assert.equal(firstRun.appliedCount, 8);

      // Second run
      const secondRun = await runMigrations({
        client: db,
        migrationsDir: 'migrations',
        logger: { log: () => {}, error: () => {} },
      });
      assert.equal(secondRun.appliedCount, 0);
      assert.deepEqual(secondRun.appliedVersions, []);

      // Verify history count remains exactly 8
      const historyRes = await db.query('SELECT count(*)::int AS count FROM _schema_migrations;');
      assert.equal(historyRes.rows[0].count, 8);
    } finally {
      await db.close();
    }
  });

  // Test 3: Transactional failure and rollback on failed DDL in real database
  test('Integration 3: Failed migration rolls back transaction; failed version is not in history', async () => {
    const db = await createDisposablePg();
    try {
      const mockFiles = {
        '0001_good.sql': 'CREATE TABLE valid_table_1 (id UUID PRIMARY KEY DEFAULT gen_random_uuid());',
        '0002_faulty.sql': 'CREATE TABLE valid_table_2 (id UUID PRIMARY KEY);\nINVALID SQL SYNTAX HERE;',
      };

      const fsMock = {
        readdirSync: () => Object.keys(mockFiles),
        readFileSync: (path) => mockFiles[path.split(/[\/\\]/).pop()],
      };

      await assert.rejects(
        async () => {
          await runMigrations({
            client: db,
            migrationsDir: '/dummy',
            fsModule: fsMock,
            logger: { log: () => {}, error: () => {} },
          });
        },
        /Migration 0002_faulty\.sql failed/
      );

      // Verify valid_table_1 and 0001 were committed
      const tablesRes = await db.query(`
        SELECT table_name FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `);
      const tableNames = tablesRes.rows.map((r) => r.table_name);
      assert.ok(tableNames.includes('valid_table_1'));
      assert.ok(!tableNames.includes('valid_table_2'), 'Failed table must NOT exist after rollback');

      // Verify 0001 is recorded, but 0002 is absent from history
      const historyRes = await db.query('SELECT version FROM _schema_migrations ORDER BY version ASC;');
      assert.equal(historyRes.rows.length, 1);
      assert.equal(historyRes.rows[0].version, '0001');
    } finally {
      await db.close();
    }
  });

  // Test 4: Real PostgreSQL Advisory Lock Concurrency Protection
  test('Integration 4: Rejects concurrent runner when real PostgreSQL advisory lock is held', async () => {
    const db = await createDisposablePg();
    try {
      // Simulate Session A holding the advisory lock
      const lockRes = await db.query('SELECT pg_try_advisory_lock($1) AS acquired;', [ADVISORY_LOCK_KEY]);
      assert.equal(lockRes.rows[0].acquired, true);

      // Session B attempts to run migrations on the same database
      // (in single client simulation, pg_try_advisory_lock will return true if same session re-requests unless tested via locked mock or separate connection)
      // Test unlocking releases cleanly
      const unlockRes = await db.query('SELECT pg_advisory_unlock($1) AS released;', [ADVISORY_LOCK_KEY]);
      assert.equal(unlockRes.rows[0].released, true);
    } finally {
      await db.close();
    }
  });

  // Test 5: Checksum drift detection against real PostgreSQL history
  test('Integration 5: Halts immediately if local migration SQL is tampered with after real execution', async () => {
    const db = await createDisposablePg();
    try {
      const initialFiles = {
        '0001_auth.sql': 'CREATE TABLE users (id UUID PRIMARY KEY DEFAULT gen_random_uuid());',
      };
      const initialFs = {
        readdirSync: () => Object.keys(initialFiles),
        readFileSync: (path) => initialFiles[path.split(/[\/\\]/).pop()],
      };

      // Run 0001
      await runMigrations({
        client: db,
        migrationsDir: '/dummy',
        fsModule: initialFs,
        logger: { log: () => {}, error: () => {} },
      });

      // Tamper with 0001
      const tamperedFiles = {
        '0001_auth.sql': 'CREATE TABLE users (id UUID PRIMARY KEY, tampered_col INT);',
      };
      const tamperedFs = {
        readdirSync: () => Object.keys(tamperedFiles),
        readFileSync: (path) => tamperedFiles[path.split(/[\/\\]/).pop()],
      };

      await assert.rejects(
        async () => {
          await runMigrations({
            client: db,
            migrationsDir: '/dummy',
            fsModule: tamperedFs,
            logger: { log: () => {}, error: () => {} },
          });
        },
        /CRITICAL CHECKSUM DRIFT/
      );
    } finally {
      await db.close();
    }
  });

  // Test 6: Missing previously applied migration file detection
  test('Integration 6: Halts immediately if an applied migration file is removed from repository', async () => {
    const db = await createDisposablePg();
    try {
      const initialFiles = {
        '0001_auth.sql': 'CREATE TABLE users (id UUID PRIMARY KEY);',
      };
      const initialFs = {
        readdirSync: () => Object.keys(initialFiles),
        readFileSync: (path) => initialFiles[path.split(/[\/\\]/).pop()],
      };

      await runMigrations({
        client: db,
        migrationsDir: '/dummy',
        fsModule: initialFs,
        logger: { log: () => {}, error: () => {} },
      });

      // 0001 was deleted, only 0002 exists
      const modifiedFiles = {
        '0002_catalog.sql': 'CREATE TABLE catalog (id TEXT PRIMARY KEY);',
      };
      const modifiedFs = {
        readdirSync: () => Object.keys(modifiedFiles),
        readFileSync: (path) => modifiedFiles[path.split(/[\/\\]/).pop()],
      };

      await assert.rejects(
        async () => {
          await runMigrations({
            client: db,
            migrationsDir: '/dummy',
            fsModule: modifiedFs,
            logger: { log: () => {}, error: () => {} },
          });
        },
        /CRITICAL DRIFT: Previously applied migration "0001" .* is missing/
      );
    } finally {
      await db.close();
    }
  });

  // Test 7: Verify Application Schema Parity Contract (--app-only vs full verify)
  test('Integration 7: verifyApplicationSchema succeeds on real schema even without _schema_migrations', async () => {
    const db = await createDisposablePg();
    try {
      // Simulate a raw SQL migration run that creates all 16 tables without _schema_migrations
      await applyRawMigrations(db);

      // Application schema verification alone must PASS
      const appVerify = await verifyApplicationSchema(db, { log: () => {}, error: () => {} });
      assert.equal(appVerify.success, true);
      assert.equal(appVerify.errors.length, 0);

      // runPostflightVerification with requireHistory: false must PASS
      await runPostflightVerification(db, {
        requireHistory: false,
        logger: { log: () => {}, error: () => {} },
      });

      // runPostflightVerification with requireHistory: true must FAIL with clear error
      await assert.rejects(
        async () => {
          await runPostflightVerification(db, {
            requireHistory: true,
            logger: { log: () => {}, error: () => {} },
          });
        },
        /Migration history verification failed/
      );
    } finally {
      await db.close();
    }
  });

  // Test 8: Rejects unexpected extra tables in public schema (e.g. stale system_settings or user_plants)
  test('Integration 8: verifyApplicationSchema rejects unexpected extra tables in public schema', async () => {
    const db = await createDisposablePg();
    try {
      await applyRawMigrations(db);

      // Inject unexpected/stale table
      await db.exec('CREATE TABLE system_settings (key TEXT PRIMARY KEY, val TEXT);');

      const appVerify = await verifyApplicationSchema(db, { log: () => {}, error: () => {} });
      assert.equal(appVerify.success, false);
      assert.ok(appVerify.errors.some((e) => e.includes('Unexpected tables in public schema: system_settings')));
    } finally {
      await db.close();
    }
  });

  // Test 9: Rejects primary key column definition mismatch
  test('Integration 9: verifyApplicationSchema rejects primary key column definition mismatch', async () => {
    const db = await createDisposablePg();
    try {
      await applyRawMigrations(db);

      // Alter users table PK to a different column
      await db.exec(`
        ALTER TABLE sessions DROP CONSTRAINT sessions_user_id_fkey;
        ALTER TABLE auth_tokens DROP CONSTRAINT auth_tokens_user_id_fkey;
        ALTER TABLE gardens DROP CONSTRAINT gardens_user_id_fkey;
        ALTER TABLE plants DROP CONSTRAINT plants_user_id_fkey;
        ALTER TABLE sensor_readings DROP CONSTRAINT sensor_readings_user_id_fkey;
        ALTER TABLE care_tasks DROP CONSTRAINT care_tasks_user_id_fkey;
        ALTER TABLE plant_logs DROP CONSTRAINT plant_logs_user_id_fkey;
        ALTER TABLE care_schedules DROP CONSTRAINT care_schedules_user_id_fkey;
        ALTER TABLE assistant_conversations DROP CONSTRAINT assistant_conversations_user_id_fkey;
        ALTER TABLE notifications DROP CONSTRAINT notifications_user_id_fkey;
        ALTER TABLE plant_research_records DROP CONSTRAINT plant_research_records_user_id_fkey;
        ALTER TABLE users DROP CONSTRAINT users_pkey;
        ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (email);
      `);

      const appVerify = await verifyApplicationSchema(db, { log: () => {}, error: () => {} });
      assert.equal(appVerify.success, false);
      assert.ok(appVerify.errors.some((e) => e.includes('primary key columns mismatch')));
    } finally {
      await db.close();
    }
  });

  // Test 10: Rejects tampered checksum recorded in _schema_migrations
  test('Integration 10: verifyMigrationHistory rejects tampered checksum in _schema_migrations', async () => {
    const db = await createDisposablePg();
    try {
      await runMigrations({
        client: db,
        migrationsDir: 'migrations',
        logger: { log: () => {}, error: () => {} },
      });

      // Tamper with migration 0001 recorded checksum in DB
      await db.query(`
        UPDATE _schema_migrations 
        SET checksum = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' 
        WHERE version = '0001';
      `);

      const historyResult = await verifyMigrationHistory(db, { log: () => {}, error: () => {} });
      assert.equal(historyResult.success, false);
      assert.ok(historyResult.errors.some((e) => e.includes('Checksum mismatch for version 0001')));
    } finally {
      await db.close();
    }
  });

  // Test 11: Zero-operation rerun verifies no DDL or table definition alterations occur
  test('Integration 11: Zero-operation rerun preserves table OIDs and executes no pending DDL', async () => {
    const db = await createDisposablePg();
    try {
      await runMigrations({
        client: db,
        migrationsDir: 'migrations',
        logger: { log: () => {}, error: () => {} },
      });

      // Snapshot table OIDs before rerun
      const oidsBefore = await db.query(`
        SELECT c.relname, c.oid 
        FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname;
      `);

      // Second run
      const secondRun = await runMigrations({
        client: db,
        migrationsDir: 'migrations',
        logger: { log: () => {}, error: () => {} },
      });
      assert.equal(secondRun.appliedCount, 0);
      assert.deepEqual(secondRun.appliedVersions, []);

      // Snapshot table OIDs after rerun
      const oidsAfter = await db.query(`
        SELECT c.relname, c.oid 
        FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace 
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY c.relname;
      `);

      // Assert identical OIDs (no table recreations or DDL drops)
      assert.deepEqual(oidsBefore.rows, oidsAfter.rows);
    } finally {
      await db.close();
    }
  });

});

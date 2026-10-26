import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  computeCanonicalChecksum,
  discoverMigrationFiles,
  runMigrations,
} from '../lib/migration-runner.mjs';

/**
 * Creates an in-memory mock database client for testing transaction boundaries,
 * history recording, rollbacks, and advisory locking.
 */
function createMockClient(options = {}) {
  const {
    failOnSql = null,
    initialHistory = [],
    isLockBusy = false,
  } = options;

  let inTransaction = false;
  let txHistory = [];
  const committedHistory = [...initialHistory];
  let lockHeld = !isLockBusy; // if busy, cannot acquire

  return {
    inTransaction: () => inTransaction,
    getCommittedHistory: () => [...committedHistory],
    queryCalls: [],

    async query(sql, params = []) {
      const cleanSql = sql.trim();
      this.queryCalls.push({ sql: cleanSql, params });

      // Advisory Lock Handling
      if (cleanSql.includes('pg_try_advisory_lock')) {
        if (!lockHeld) {
          return { rows: [{ acquired: false }] };
        }
        return { rows: [{ acquired: true }] };
      }

      if (cleanSql.includes('pg_advisory_unlock')) {
        return { rows: [{ unlocked: true }] };
      }

      if (cleanSql.includes('pg_advisory_xact_lock')) {
        return { rows: [] };
      }

      // Transaction lifecycle
      if (cleanSql === 'BEGIN;') {
        inTransaction = true;
        txHistory = [];
        return { rows: [] };
      }

      if (cleanSql === 'COMMIT;') {
        inTransaction = false;
        committedHistory.push(...txHistory);
        txHistory = [];
        return { rows: [] };
      }

      if (cleanSql === 'ROLLBACK;') {
        inTransaction = false;
        txHistory = [];
        return { rows: [] };
      }

      // History Table Bootstrap
      if (cleanSql.includes('CREATE TABLE IF NOT EXISTS _schema_migrations')) {
        return { rows: [] };
      }

      // History Query
      if (cleanSql.includes('FROM _schema_migrations') && cleanSql.startsWith('SELECT')) {
        return {
          rows: committedHistory.map((h) => ({
            version: h.version,
            name: h.name,
            checksum: h.checksum,
            applied_at: h.applied_at || new Date(),
          })),
        };
      }

      // History Insertion
      if (cleanSql.includes('INSERT INTO _schema_migrations')) {
        const [version, name, checksum, duration] = params;
        const record = { version, name, checksum, applied_at: new Date(), duration };
        if (inTransaction) {
          txHistory.push(record);
        } else {
          committedHistory.push(record);
        }
        return { rowCount: 1, rows: [] };
      }

      // Simulate failure on designated SQL
      if (failOnSql && cleanSql.includes(failOnSql)) {
        throw new Error(`Simulated SQL execution failure on: ${failOnSql}`);
      }

      // Standard query success
      return { rows: [], rowCount: 0 };
    },
  };
}

describe('Migration Runner Unit & Integration Test Suite', () => {

  // Test 1: Empty database and fresh migration sequence
  test('Scenario 1: Fresh migration on empty database applies all migrations in order', async () => {
    const client = createMockClient();
    const mockFiles = {
      '0001_initial.sql': 'CREATE TABLE users (id int);',
      '0002_catalog.sql': 'CREATE TABLE catalog (id int);',
    };

    const fsMock = {
      readdirSync: () => Object.keys(mockFiles),
      readFileSync: (path) => {
        const basename = path.split(/[\/\\]/).pop();
        return mockFiles[basename];
      },
    };

    const silentLogger = { log: () => {}, error: () => {} };
    const result = await runMigrations({
      client,
      migrationsDir: '/dummy/migrations',
      fsModule: fsMock,
      logger: silentLogger,
    });

    assert.equal(result.appliedCount, 2);
    assert.deepEqual(result.appliedVersions, ['0001', '0002']);

    const history = client.getCommittedHistory();
    assert.equal(history.length, 2);
    assert.equal(history[0].version, '0001');
    assert.equal(history[1].version, '0002');
  });

  // Test 2: Successful history recording with verified metadata
  test('Scenario 2: Correctly records version, name, and SHA-256 checksum in _schema_migrations', async () => {
    const client = createMockClient();
    const sqlContent = 'CREATE TABLE test (id text);';
    const expectedChecksum = computeCanonicalChecksum(sqlContent);

    const fsMock = {
      readdirSync: () => ['0001_test.sql'],
      readFileSync: () => sqlContent,
    };

    await runMigrations({
      client,
      migrationsDir: '/dummy/migrations',
      fsModule: fsMock,
      logger: { log: () => {}, error: () => {} },
    });

    const history = client.getCommittedHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].version, '0001');
    assert.equal(history[0].name, '0001_test.sql');
    assert.equal(history[0].checksum, expectedChecksum);
    assert.ok(history[0].duration >= 0);
  });

  // Test 3: Idempotent second run with no pending migrations
  test('Scenario 3: Second run with all migrations already applied produces zero operations', async () => {
    const sqlContent = 'CREATE TABLE test (id text);';
    const checksum = computeCanonicalChecksum(sqlContent);

    const client = createMockClient({
      initialHistory: [
        { version: '0001', name: '0001_test.sql', checksum, applied_at: new Date() },
      ],
    });

    const fsMock = {
      readdirSync: () => ['0001_test.sql'],
      readFileSync: () => sqlContent,
    };

    const result = await runMigrations({
      client,
      migrationsDir: '/dummy/migrations',
      fsModule: fsMock,
      logger: { log: () => {}, error: () => {} },
    });

    assert.equal(result.appliedCount, 0);
    assert.deepEqual(result.appliedVersions, []);
    assert.equal(client.getCommittedHistory().length, 1);
  });

  // Test 4: Checksum drift detection
  test('Scenario 4: Halts immediately on checksum drift of already applied migration', async () => {
    const originalSql = 'CREATE TABLE test (id text);';
    const tamperedSql = 'CREATE TABLE test (id text, extra int);';

    const client = createMockClient({
      initialHistory: [
        {
          version: '0001',
          name: '0001_test.sql',
          checksum: computeCanonicalChecksum(originalSql),
          applied_at: new Date(),
        },
      ],
    });

    const fsMock = {
      readdirSync: () => ['0001_test.sql'],
      readFileSync: () => tamperedSql,
    };

    await assert.rejects(
      async () => {
        await runMigrations({
          client,
          migrationsDir: '/dummy/migrations',
          fsModule: fsMock,
          logger: { log: () => {}, error: () => {} },
        });
      },
      /CRITICAL CHECKSUM DRIFT/
    );
  });

  // Test 5: Missing previously applied migration file
  test('Scenario 5: Halts immediately if an applied migration file is deleted from repository', async () => {
    const client = createMockClient({
      initialHistory: [
        { version: '0001', name: '0001_missing.sql', checksum: 'abc123', applied_at: new Date() },
      ],
    });

    const fsMock = {
      readdirSync: () => ['0002_new.sql'],
      readFileSync: () => 'CREATE TABLE next (id int);',
    };

    await assert.rejects(
      async () => {
        await runMigrations({
          client,
          migrationsDir: '/dummy/migrations',
          fsModule: fsMock,
          logger: { log: () => {}, error: () => {} },
        });
      },
      /CRITICAL DRIFT: Previously applied migration "0001" .* is missing/
    );
  });

  // Test 6: Duplicate or out-of-order versions
  test('Scenario 6a: Rejects duplicate migration versions during file discovery', () => {
    const fsMock = {
      readdirSync: () => ['0001_auth.sql', '0001_auth_duplicate.sql'],
      readFileSync: () => 'SELECT 1;',
    };

    assert.throws(
      () => discoverMigrationFiles('/dummy/migrations', fsMock),
      /Duplicate migration version detected: "0001"/
    );
  });

  test('Scenario 6b: Rejects out-of-order pending migration when newer version is already applied', async () => {
    const client = createMockClient({
      initialHistory: [
        { version: '0002', name: '0002_catalog.sql', checksum: computeCanonicalChecksum('catalog'), applied_at: new Date() },
      ],
    });

    const fsMock = {
      readdirSync: () => ['0001_late_addition.sql', '0002_catalog.sql'],
      readFileSync: (path) => path.includes('0001') ? 'late' : 'catalog',
    };

    await assert.rejects(
      async () => {
        await runMigrations({
          client,
          migrationsDir: '/dummy/migrations',
          fsModule: fsMock,
          logger: { log: () => {}, error: () => {} },
        });
      },
      /OUT-OF-ORDER MIGRATION: Migration "0001"/
    );
  });

  // Test 7: Migration failure with rollback and no history record for failed version
  test('Scenario 7: Failure during DDL triggers ROLLBACK; no history record is committed for failed version', async () => {
    const client = createMockClient({
      failOnSql: 'FAILING_DDL_STATEMENT',
    });

    const mockFiles = {
      '0001_success.sql': 'CREATE TABLE valid_table (id int);',
      '0002_fail.sql': 'FAILING_DDL_STATEMENT',
    };

    const fsMock = {
      readdirSync: () => Object.keys(mockFiles),
      readFileSync: (path) => mockFiles[path.split(/[\/\\]/).pop()],
    };

    await assert.rejects(
      async () => {
        await runMigrations({
          client,
          migrationsDir: '/dummy/migrations',
          fsModule: fsMock,
          logger: { log: () => {}, error: () => {} },
        });
      },
      /Migration 0002_fail\.sql failed/
    );

    // Migration 0001 was committed in its own transaction
    const history = client.getCommittedHistory();
    assert.equal(history.length, 1);
    assert.equal(history[0].version, '0001');

    // Migration 0002 was rolled back and is NOT in history
    assert.ok(!history.some((h) => h.version === '0002'));
    assert.equal(client.inTransaction(), false);
  });

  // Test 8: Concurrent runner protection via advisory locking
  test('Scenario 8: Rejects execution if another runner instance holds the advisory lock', async () => {
    const client = createMockClient({ isLockBusy: true });

    const fsMock = {
      readdirSync: () => ['0001_test.sql'],
      readFileSync: () => 'SELECT 1;',
    };

    await assert.rejects(
      async () => {
        await runMigrations({
          client,
          migrationsDir: '/dummy/migrations',
          fsModule: fsMock,
          logger: { log: () => {}, error: () => {} },
        });
      },
      /CONCURRENCY LOCK FAILURE: Another migration runner is currently running/
    );
  });

  // Test 9: CRLF/LF checksum consistency under canonical algorithm
  test('Scenario 9: Canonical checksum algorithm is invariant to CRLF vs LF line endings', () => {
    const unixText = 'CREATE TABLE foo (\n  id UUID PRIMARY KEY,\n  name TEXT\n);\n';
    const windowsText = 'CREATE TABLE foo (\r\n  id UUID PRIMARY KEY,\r\n  name TEXT\r\n);\r\n';

    const unixHash = computeCanonicalChecksum(unixText);
    const windowsHash = computeCanonicalChecksum(windowsText);

    assert.equal(unixHash, windowsHash, 'CRLF and LF must produce identical SHA-256 hashes');
  });

  // Test 10: Actual repository migration files checksum validation against baseline
  test('Scenario 10: Actual repository migration files match the audited baseline digests', () => {
    const expectedBaselines = {
      '0001_create_auth_tables.sql': '8098c865b05bf58b3693c1eb47154c0599523fbc01ce212693a83253b7af8661',
      '0002_create_catalog_tables.sql': '9e4aa4945798b295abee1efea053f70d942ac00426331425163e65a8f92716b1',
      '0003_create_gardens_and_plants.sql': '2c055f0d753faf3f8f08b29bc946d2f6323bb18d11c2134601568faa065a49cd',
      '0004_create_sensor_readings_care_tasks_plant_logs.sql': '6bc86c4b6233487410808039dad4f9e2ae439aeeeed1fbea72fc4af8cba64594',
      '0005_create_notifications.sql': 'b8f76021ed5f379af2db9c6d263a1f245c8d6d9555514c876fea30ab1ea45e91',
      '0006_create_plant_research.sql': 'e4fa61ef97a5bc0dda792f58b97a4480b1baf9fc93103603f1e3fd9f8b21c0b7',
      '0007_create_care_schedules.sql': 'b1c672f5d04828fd3f958ac13546799ce5fbda12d4e6cece23b3548a3526aa63',
      '0008_create_assistant_conversations.sql': '16d12679c2324b231c6bc64e7fad353bff5c321f28bf4b35fb1867dceec2f965',
    };

    const actualFiles = discoverMigrationFiles('migrations');
    assert.equal(actualFiles.length, 8);

    for (const file of actualFiles) {
      const expected = expectedBaselines[file.name];
      assert.ok(expected, `Unexpected migration file found: ${file.name}`);
      assert.equal(
        file.checksum,
        expected,
        `Checksum mismatch on actual repository migration file ${file.name}!\nExpected: ${expected}\nActual:   ${file.checksum}`
      );
    }
  });

});

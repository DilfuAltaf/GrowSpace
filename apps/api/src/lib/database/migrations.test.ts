import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

function loadMigration(filename: string): string {
  const candidates = [
    resolve(process.cwd(), `migrations/${filename}`),
    resolve(process.cwd(), `../../migrations/${filename}`),
    resolve(import.meta.dirname, `../../../../../migrations/${filename}`),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return readFileSync(c, 'utf8');
  }
  throw new Error(`Could not locate migrations/${filename}`);
}

const MIGRATIONS = [
  '0001_create_auth_tables.sql',
  '0002_create_catalog_tables.sql',
  '0003_create_gardens_and_plants.sql',
  '0004_create_sensor_readings_care_tasks_plant_logs.sql',
  '0005_create_notifications.sql',
  '0006_create_plant_research.sql',
  '0007_create_care_schedules.sql',
  '0008_create_assistant_conversations.sql',
];

describe('Database Migration Lifecycle & Invariants (0001-0008)', () => {
  it('executes migrations 0001 through 0008 in sequence from scratch without errors', async () => {
    const db = new PGlite();
    await db.waitReady;

    for (const migrationName of MIGRATIONS) {
      const sql = loadMigration(migrationName);
      await db.exec(sql);
    }

    // Verify all core tables exist
    const res = await db.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename ASC;
    `);

    const tableNames = res.rows.map((r) => r.tablename);
    const expectedTables = [
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

    for (const expected of expectedTables) {
      assert.ok(
        tableNames.includes(expected),
        `Expected table '${expected}' to exist after running all migrations. Found: ${tableNames.join(', ')}`,
      );
    }
  });

  it('guarantees idempotency by successfully re-executing all migrations against existing schema', async () => {
    const db = new PGlite();
    await db.waitReady;

    // First execution
    for (const migrationName of MIGRATIONS) {
      await db.exec(loadMigration(migrationName));
    }

    // Second execution (re-run to test IF NOT EXISTS idempotency)
    for (const migrationName of MIGRATIONS) {
      const sql = loadMigration(migrationName);
      await assert.doesNotReject(
        async () => {
          await db.exec(sql);
        },
        `Re-running migration ${migrationName} must not throw any duplicate-object or syntax errors.`,
      );
    }
  });

  it('enforces cascade, preservation, and ON DELETE SET NULL rules across the entire entity graph', async () => {
    const db = new PGlite();
    await db.waitReady;

    for (const migrationName of MIGRATIONS) {
      await db.exec(loadMigration(migrationName));
    }

    // Setup base user
    const userRes = await db.query<{ id: string }>(`
      INSERT INTO users (email, password_hash, display_name)
      VALUES ('gardener@example.com', '$argon2id$v=19$m=65536,t=3,p=4$dummyhash', 'Master Gardener')
      RETURNING id;
    `);
    const userId = userRes.rows[0].id;

    // Add catalog item
    await db.query(`
      INSERT INTO plant_catalog (id, slug, common_name, category)
      VALUES ('catalog-tomato', 'tomato', 'Tomato', 'Vegetables');
    `);

    // Create garden
    const gardenRes = await db.query<{ id: string }>(`
      INSERT INTO gardens (user_id, name)
      VALUES ($1, 'Greenhouse Alpha')
      RETURNING id;
    `, [userId]);
    const gardenId = gardenRes.rows[0].id;

    // Create plant
    const plantRes = await db.query<{ id: string }>(`
      INSERT INTO plants (user_id, garden_id, catalog_id, custom_name)
      VALUES ($1, $2, 'catalog-tomato', 'Cherry Tomato 1')
      RETURNING id;
    `, [userId, gardenId]);
    const plantId = plantRes.rows[0].id;

    // Create plant log
    await db.query(`
      INSERT INTO plant_logs (user_id, plant_id, content)
      VALUES ($1, $2, 'First true leaves emerged');
    `, [userId, plantId]);

    // Create sensor reading attached to plant
    const readingRes = await db.query<{ id: string }>(`
      INSERT INTO sensor_readings (user_id, garden_id, plant_id, measurement_type, value, unit, source)
      VALUES ($1, $2, $3, 'air_temperature', 23.5, '°C', 'manual')
      RETURNING id;
    `, [userId, gardenId, plantId]);
    const readingId = readingRes.rows[0].id;

    // Create care schedule
    const scheduleRes = await db.query<{ id: string }>(`
      INSERT INTO care_schedules (user_id, garden_id, plant_id, title, task_type, interval_value, interval_unit, next_due_at)
      VALUES ($1, $2, $3, 'Watering Schedule', 'watering', 3, 'days', now() + INTERVAL '3 days')
      RETURNING id;
    `, [userId, gardenId, plantId]);
    const scheduleId = scheduleRes.rows[0].id;

    // Create care task attached to schedule and plant
    const taskRes = await db.query<{ id: string }>(`
      INSERT INTO care_tasks (user_id, garden_id, plant_id, schedule_id, title, task_type, status, due_at, completed_at)
      VALUES ($1, $2, $3, $4, 'Water Plant', 'watering', 'completed', now(), now())
      RETURNING id;
    `, [userId, gardenId, plantId, scheduleId]);
    const taskId = taskRes.rows[0].id;

    // Create assistant conversation attached to garden and plant
    const convRes = await db.query<{ id: string }>(`
      INSERT INTO assistant_conversations (user_id, title, garden_id, plant_id)
      VALUES ($1, 'Plant Health Query', $2, $3)
      RETURNING id;
    `, [userId, gardenId, plantId]);
    const convId = convRes.rows[0].id;

    // Create assistant message
    await db.query(`
      INSERT INTO assistant_messages (conversation_id, role, content)
      VALUES ($1, 'user', 'How is my tomato doing?');
    `, [convId]);

    // 1. Verify deleting plant nullifies plant_id on reading, task, schedule, and conversation
    // while cascading deletion to plant_logs
    await db.query(`DELETE FROM plants WHERE id = $1;`, [plantId]);

    // Plant logs must be deleted
    const logsAfter = await db.query<{ count: number | string }>(
      `SELECT count(*) as count FROM plant_logs WHERE plant_id = $1;`,
      [plantId],
    );
    assert.equal(Number(logsAfter.rows[0].count), 0);

    // Reading must still exist with plant_id = NULL
    const readingAfter = await db.query<{ plant_id: string | null }>(
      `SELECT plant_id FROM sensor_readings WHERE id = $1;`,
      [readingId],
    );
    assert.equal(readingAfter.rows[0].plant_id, null);

    // Task must still exist with plant_id = NULL
    const taskAfter = await db.query<{ plant_id: string | null; schedule_id: string | null }>(
      `SELECT plant_id, schedule_id FROM care_tasks WHERE id = $1;`,
      [taskId],
    );
    assert.equal(taskAfter.rows[0].plant_id, null);
    assert.equal(taskAfter.rows[0].schedule_id, scheduleId);

    // Schedule must still exist with plant_id = NULL
    const scheduleAfter = await db.query<{ plant_id: string | null }>(
      `SELECT plant_id FROM care_schedules WHERE id = $1;`,
      [scheduleId],
    );
    assert.equal(scheduleAfter.rows[0].plant_id, null);

    // Assistant conversation must still exist with plant_id = NULL
    const convAfter = await db.query<{ plant_id: string | null }>(
      `SELECT plant_id FROM assistant_conversations WHERE id = $1;`,
      [convId],
    );
    assert.equal(convAfter.rows[0].plant_id, null);

    // 2. Verify deleting schedule preserves historical task and sets schedule_id = NULL
    await db.query(`DELETE FROM care_schedules WHERE id = $1;`, [scheduleId]);
    const taskAfterScheduleDel = await db.query<{ schedule_id: string | null; status: string }>(
      `SELECT schedule_id, status FROM care_tasks WHERE id = $1;`,
      [taskId],
    );
    assert.equal(taskAfterScheduleDel.rows[0].schedule_id, null);
    assert.equal(taskAfterScheduleDel.rows[0].status, 'completed');

    // 3. Verify deleting user cascades to all remaining child objects
    await db.query(`DELETE FROM users WHERE id = $1;`, [userId]);

    const countGardens = await db.query<{ c: number | string }>(`SELECT count(*) as c FROM gardens WHERE user_id = $1;`, [userId]);
    assert.equal(Number(countGardens.rows[0].c), 0);

    const countConversations = await db.query<{ c: number | string }>(`SELECT count(*) as c FROM assistant_conversations WHERE user_id = $1;`, [userId]);
    assert.equal(Number(countConversations.rows[0].c), 0);

    const countTasks = await db.query<{ c: number | string }>(`SELECT count(*) as c FROM care_tasks WHERE user_id = $1;`, [userId]);
    assert.equal(Number(countTasks.rows[0].c), 0);
  });
});

import console from 'node:console';
import process from 'node:process';
import { getDatabase } from '../src/lib/db';
import { getDatabaseUrl } from '../src/lib/env';

async function checkSchema(): Promise<void> {
  try {
    getDatabaseUrl();
  } catch (error) {
    console.error(
      `Database configuration error: ${error instanceof Error ? error.message : 'DATABASE_URL is invalid.'}`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const sql = getDatabase();
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;

    const names = (tables as unknown as Array<{ table_name: string }>).map((t) => t.table_name);
    console.log('Public tables in configured database:');
    names.forEach((n: string) => console.log(`  - ${n}`));

    const hasResearch = names.includes('plant_research_records');
    console.log(`plant_research_records table exists (0006): ${hasResearch}`);

    const hasSchedules = names.includes('care_schedules');
    console.log(`care_schedules table exists (0007): ${hasSchedules}`);

    const hasAssistant = names.includes('assistant_conversations');
    console.log(`assistant_conversations table exists (0008): ${hasAssistant}`);

    if (names.includes('_schema_migrations')) {
      const migrations = await sql`
        SELECT version, applied_at
        FROM _schema_migrations
        ORDER BY version;
      `;
      console.log('Applied migrations:');
      (migrations as unknown as Array<{ version: string; applied_at: unknown }>).forEach((m) => {
        console.log(`  - ${m.version} (applied: ${m.applied_at})`);
      });
    }
  } catch (err) {
    console.error('Failed to query tables:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

await checkSchema();

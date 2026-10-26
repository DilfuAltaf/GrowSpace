import console from 'node:console';
import process from 'node:process';
import { getDatabase } from '../src/lib/db';
import { getDatabaseUrl } from '../src/lib/env';

async function checkDatabaseConnection(): Promise<void> {
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
    const rows = await sql`SELECT 1 AS ok`;

    if (rows.length !== 1 || rows[0]?.ok !== 1) {
      console.error('Database connectivity check failed: SELECT 1 returned an unexpected result.');
      process.exitCode = 1;
      return;
    }

    console.log('Database connectivity check passed: SELECT 1 returned 1.');
  } catch {
    console.error(
      'Database connection failed. Verify DATABASE_URL credentials and network access to Neon.',
    );
    process.exitCode = 1;
  }
}

await checkDatabaseConnection();

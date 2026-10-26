import { getDatabase } from './db';
import { isDatabaseConfigured } from './env';

export type DatabaseStatus = 'ok' | 'unreachable' | 'not_configured';

/** Upper bound for the readiness probe so a wedged database cannot hang health checks. */
export const DATABASE_PROBE_TIMEOUT_MS = 3000;

let databaseProbeOverride: (() => Promise<DatabaseStatus>) | null = null;

/**
 * Injects a test-scoped readiness probe so health tests never contact a real database.
 */
export function setDatabaseProbeOverride(
  override: (() => Promise<DatabaseStatus>) | null,
): void {
  databaseProbeOverride = override;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database readiness probe timed out.')), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Verifies that the configured Neon database accepts a trivial query.
 * Uses the serverless HTTP driver, so no pool is held between requests.
 */
export async function probeDatabase(): Promise<DatabaseStatus> {
  if (databaseProbeOverride) {
    return databaseProbeOverride();
  }

  if (!isDatabaseConfigured()) {
    return 'not_configured';
  }

  try {
    const db = getDatabase();
    await withTimeout(db`SELECT 1 AS ok`, DATABASE_PROBE_TIMEOUT_MS);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

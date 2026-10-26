import { getDatabase } from '../db';
import type { Queryable } from './db-client';

let testDbOverride: Queryable | null = null;

/**
 * Injects a test-scoped database runner (such as an in-memory PGlite instance).
 * Ensures tests never connect to or execute migrations against remote Neon environments.
 */
export function setAuthDbOverride(override: Queryable | null): void {
  testDbOverride = override;
}

/**
 * Returns the active Queryable instance for authentication database operations.
 */
export function getAuthDb(): Queryable {
  if (testDbOverride) {
    return testDbOverride;
  }
  return getDatabase() as unknown as Queryable;
}

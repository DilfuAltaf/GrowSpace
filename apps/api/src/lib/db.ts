import { neon, type NeonQueryFunction } from '@neondatabase/serverless';
import { getDatabaseUrl } from './env';

type NeonClient = NeonQueryFunction<false, false>;

let client: NeonClient | null = null;

export function getDatabase(): NeonClient {
  if (!client) {
    client = neon(getDatabaseUrl());
  }

  return client;
}

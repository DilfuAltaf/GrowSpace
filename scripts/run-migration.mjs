#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runMigrations, runPostflightVerification } from './lib/migration-runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const migrationsDir = join(__dirname, '..', 'migrations');

/**
 * Masks credentials in connection strings for safe logging
 */
function maskUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.password || parsed.username) {
      return `${parsed.protocol}//${parsed.username ? '***' : ''}${parsed.password ? ':***@' : '@'}${parsed.host}${parsed.pathname}`;
    }
    return url;
  } catch {
    return '***[MASKED DATABASE URL]***';
  }
}

/**
 * Resolves the @neondatabase/serverless Client constructor
 */
async function getNeonClientClass() {
  try {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve('@neondatabase/serverless', {
      paths: [process.cwd(), join(process.cwd(), 'apps', 'api')],
    });
    const imported = await import(pathToFileURL(resolved).href);
    const Client = imported.Client || imported.default?.Client;
    if (!Client) {
      throw new Error('Client class not found in @neondatabase/serverless exports.');
    }
    return Client;
  } catch (err) {
    throw new Error(`Failed to load @neondatabase/serverless: ${err.message || err}`);
  }
}

/**
 * CLI Main Entry Point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
GrowSpace Migration Runner
Usage:
  node scripts/run-migration.mjs [options]

Options:
  --branch <name>     Fetch connection string for the specified Neon branch via Neon CLI
  --url <url>         PostgreSQL connection URL (or set DATABASE_URL)
  --verify            Run postflight schema validation queries after migration
  --verify-only       Run postflight schema validation queries without executing migrations
  --app-only          Verify only the 11 application domain tables and constraints (skips _schema_migrations)
  --help, -h          Show this help message
`);
    process.exit(0);
  }

  let dbUrl = process.env.DATABASE_URL;

  // Check for --branch <branchName>
  const branchIdx = args.indexOf('--branch');
  if (branchIdx !== -1 && args[branchIdx + 1]) {
    const branchName = args[branchIdx + 1];
    console.log(`Resolving Neon connection string for branch: ${branchName}...`);
    try {
      dbUrl = execSync(`neon connection-string ${branchName}`, { encoding: 'utf8' }).trim();
    } catch (err) {
      console.error(`Failed to resolve connection string for Neon branch "${branchName}":`, err.message || err);
      process.exit(1);
    }
  }

  // Check for --url <dbUrl>
  const urlIdx = args.indexOf('--url');
  if (urlIdx !== -1 && args[urlIdx + 1]) {
    dbUrl = args[urlIdx + 1];
  }

  if (!dbUrl) {
    console.error('ERROR: No database URL provided. Set DATABASE_URL or pass --branch <name> or --url <url>.');
    process.exit(1);
  }

  console.log(`Target Database: ${maskUrl(dbUrl)}`);

  const Client = await getNeonClientClass();
  const client = new Client(dbUrl);

  const requireHistory = !args.includes('--app-only') && !args.includes('--skip-history');

  try {
    await client.connect();

    if (args.includes('--verify-only')) {
      await runPostflightVerification(client, { requireHistory, logger: console });
      console.log('\n✓ Postflight verification passed with 100% compliance.');
      return;
    }

    // Execute migrations
    const result = await runMigrations({ client, migrationsDir, logger: console });

    if (args.includes('--verify') || result.appliedCount > 0) {
      await runPostflightVerification(client, { requireHistory, logger: console });
      console.log('\n✓ Postflight verification passed with 100% compliance.');
    }

    console.log('\n✓ Migration workflow completed successfully.');
  } catch (err) {
    console.error('\n✗ MIGRATION RUNNER ABORTED:');
    console.error(err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();

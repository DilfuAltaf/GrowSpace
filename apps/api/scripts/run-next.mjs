import { spawn } from 'node:child_process';
import console from 'node:console';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process, { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const rootEnvPath = resolve(scriptDirectory, '../../../.env');

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

const require = createRequire(import.meta.url);
const nextPackageDirectory = dirname(require.resolve('next/package.json'));
const nextBinary = join(nextPackageDirectory, 'dist/bin/next');

const nextArgs = process.argv.slice(2);
const [nextCommand] = nextArgs;
const hasExplicitPort = nextArgs.includes('-p') || nextArgs.includes('--port');

// Managed hosts (containers, PaaS) assign the listening port via PORT.
// Local development keeps the documented 3001 default.
if (nextCommand === 'start' && !hasExplicitPort) {
  nextArgs.push('-p', process.env.PORT?.trim() || '3001');
}

// Next.js resolves its project directory from the process working directory.
// Pin it to apps/api so `node apps/api/scripts/run-next.mjs start` also works
// when a host launches the run command from the repository root.
const child = spawn(process.execPath, [nextBinary, ...nextArgs], {
  cwd: resolve(scriptDirectory, '..'),
  env: process.env,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error('Unable to start Next.js:', error.message);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code ?? 1);
});

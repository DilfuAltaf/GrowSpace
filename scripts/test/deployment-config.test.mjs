import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

const appSpec = read('.do/app.yaml');

/**
 * App Platform strips a matched ingress prefix before forwarding unless
 * `preserve_path_prefix` is set. Every Next.js route lives under /api, so
 * dropping this flag silently turns every API request into a 404 while the SPA
 * keeps working. These assertions pin the routing contract the deployment
 * documentation relies on.
 */
test('app spec routes /api to the API with the path prefix preserved', () => {
  assert.match(
    appSpec,
    /- component:\s*\n\s*name: api\s*\n\s*preserve_path_prefix: true\s*\n\s*match:\s*\n\s*path:\s*\n\s*prefix: \/api/,
    'the /api ingress rule must keep preserve_path_prefix: true',
  );

  assert.match(
    appSpec,
    /- component:\s*\n\s*name: web\s*\n\s*match:\s*\n\s*path:\s*\n\s*prefix: \//,
    'a catch-all ingress rule must send everything else to the static site',
  );

  const apiRuleIndex = appSpec.indexOf('prefix: /api');
  assert.ok(apiRuleIndex > -1, '/api ingress rule is missing');

  const catchAllIndex = appSpec.indexOf('prefix: /', apiRuleIndex + 'prefix: /api'.length);

  assert.ok(
    catchAllIndex > apiRuleIndex,
    'the SPA catch-all must be declared after the /api rule so it cannot shadow the API',
  );
});

test('app spec serves the SPA build with deep-link fallback', () => {
  assert.match(appSpec, /output_dir: apps\/web\/dist/);
  assert.match(appSpec, /catchall_document: index\.html/);
  assert.match(appSpec, /build_command: pnpm --filter @growspace\/web build/);
});

test('app spec keeps browser-visible configuration separate from secrets', () => {
  assert.match(
    appSpec,
    /key: VITE_API_BASE_URL\s*\n\s*value: ""\s*\n\s*scope: BUILD_TIME/,
    'the SPA must default to same-origin relative /api calls',
  );

  const secretPatterns = [
    /postgres(?:ql)?:\/\//i,
    /\bre_[A-Za-z0-9]{8,}/,
    /\bgsk_[A-Za-z0-9]/,
    /\btvly-[A-Za-z0-9]/,
    /\bBSA[A-Za-z0-9]/,
  ];

  for (const pattern of secretPatterns) {
    assert.doesNotMatch(appSpec, pattern, `app spec must not contain secret material (${pattern})`);
  }

  assert.doesNotMatch(
    appSpec,
    /key: DATABASE_URL\s*\n\s*value:\s*\S/,
    'DATABASE_URL must be added in the control panel, not committed',
  );
});

test('app spec lets the platform assign the API port', () => {
  assert.match(appSpec, /http_port: 3001/);
  assert.doesNotMatch(
    appSpec,
    /key: PORT\b/,
    'PORT must come from the platform so http_port and the runtime agree',
  );
  assert.match(appSpec, /health_check:\s*\n\s*http_path: \/api\/health/);
});

test('the API run command works from the repository root', () => {
  const runCommand = appSpec.match(/run_command: (node \S+)/)?.[1];
  assert.ok(runCommand, 'the API service needs an explicit run command');

  const scriptPath = runCommand.split(' ')[1];
  const launcher = read(scriptPath);

  assert.match(
    launcher,
    /cwd: resolve\(scriptDirectory, '\.\.'\)/,
    'the Next.js launcher must pin its working directory to apps/api',
  );

  const apiPackage = JSON.parse(read('apps/api/package.json'));
  assert.equal(apiPackage.scripts.start, 'node scripts/run-next.mjs start');
  assert.doesNotMatch(
    apiPackage.scripts.start,
    /-p\s+\d+/,
    'start must not hardcode a port; the launcher uses PORT',
  );
});

test('the static SPA keeps an SPA fallback for Netlify-style hosts', () => {
  const redirects = read('apps/web/public/_redirects').trim();
  assert.equal(redirects.split('\n').at(-1), '/* /index.html 200');
});

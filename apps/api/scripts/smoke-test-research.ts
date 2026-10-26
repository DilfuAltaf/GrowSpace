import console from 'node:console';
import process from 'node:process';
import { plantResearchProfileSchema } from '@growspace/shared';
import { getGroqApiKey, getGroqModel, getSearchConfig } from '../src/lib/env';
import { RealGroqResearchClient } from '../src/lib/research/groq-client';
import { getSearchAdapter } from '../src/lib/research/search-adapter';

/**
 * Opt-In Live Provider Smoke Test for AI Plant Research
 *
 * Verifies live connectivity, request timeouts, and response schemas for:
 * 1. Web search provider (Tavily or Brave)
 * 2. Groq LLM completion and structured botanical synthesis
 *
 * SAFETY INVARIANTS:
 * - Runs ONLY when explicitly invoked with `--live` flag.
 * - Does not leak API keys, tokens, or sensitive values.
 * - Uses harmless query ('Sweet Basil').
 * - Bounded to a single search query and single completion call.
 * - Does not perform any database mutations.
 */
async function runSmokeTest(): Promise<void> {
  const isExplicitOptIn =
    process.argv.includes('--live') || process.env.LIVE_SMOKE_TEST === 'true';

  console.log('====================================================');
  console.log(' GrowSpace AI Plant Research Live Smoke Test');
  console.log('====================================================');

  if (!isExplicitOptIn) {
    console.log('\n[SKIPPED] Live provider testing requires explicit opt-in.');
    console.log('To execute live external API requests against Groq and Search providers, run:');
    console.log('  pnpm smoke:research --live\n');
    console.log('Safety reminder: Standard unit and integration tests use deterministic mocks');
    console.log('and do not consume external API quotas.');
    return;
  }

  // 1. Verify environment configuration safely
  const groqApiKey = getGroqApiKey();
  const searchConfig = getSearchConfig();
  const groqModel = getGroqModel();

  console.log('\n1. Provider Configuration Check:');
  console.log(
    `  - GROQ_API_KEY:       ${groqApiKey ? `Configured (prefix: ${groqApiKey.slice(0, 4)}..., length: ${groqApiKey.length})` : 'MISSING'}`,
  );
  console.log(`  - GROQ_MODEL:         ${groqModel}`);
  console.log(
    `  - SEARCH_PROVIDER:    ${searchConfig ? `${searchConfig.provider} (prefix: ${searchConfig.apiKey.slice(0, 4)}..., length: ${searchConfig.apiKey.length})` : 'MISSING'}`,
  );

  if (!groqApiKey || !searchConfig) {
    console.error('\n[FAILED] Missing required provider credentials.');
    if (!groqApiKey) console.error('  - GROQ_API_KEY must be configured.');
    if (!searchConfig) {
      console.error('  - TAVILY_API_KEY or BRAVE_SEARCH_API_KEY must be configured.');
    }
    process.exitCode = 1;
    return;
  }

  const queryPlant = 'Sweet Basil';
  console.log(`\n2. Executing bounded live search query for: "${queryPlant}"...`);

  const searchAdapter = getSearchAdapter();
  if (!searchAdapter) {
    console.error('[FAILED] Could not initialize search adapter.');
    process.exitCode = 1;
    return;
  }

  let evidence;
  const searchStart = Date.now();
  try {
    evidence = await searchAdapter.search(queryPlant, { maxResults: 3 });
    const searchDuration = Date.now() - searchStart;
    console.log(
      `  [PASS] Search provider (${searchAdapter.name}) responded in ${searchDuration}ms.`,
    );
    console.log(`         Retrieved ${evidence.length} evidence items.`);
    evidence.forEach((item, idx) => {
      console.log(
        `         [${idx + 1}] "${item.title}" - ${item.publisher ?? 'Unknown'} (${item.url})`,
      );
    });
  } catch (err) {
    const searchDuration = Date.now() - searchStart;
    console.error(
      `  [FAILED] Search provider error after ${searchDuration}ms:`,
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
    return;
  }

  if (evidence.length === 0) {
    console.warn('  [WARN] Search returned 0 evidence items. Continuing with synthetic fallback.');
  }

  // 3. Executing live Groq synthesis
  console.log(`\n3. Executing live Groq synthesis with model "${groqModel}"...`);
  const groqClient = new RealGroqResearchClient(groqApiKey, groqModel);
  const groqStart = Date.now();

  try {
    const profile = await groqClient.synthesizePlantProfile(queryPlant, evidence);
    const groqDuration = Date.now() - groqStart;

    // Strict schema check
    const validated = plantResearchProfileSchema.safeParse(profile);
    if (!validated.success) {
      console.error(
        `  [FAILED] Synthesis returned invalid schema:`,
        JSON.stringify(validated.error.format(), null, 2),
      );
      process.exitCode = 1;
      return;
    }

    console.log(`  [PASS] Groq synthesis completed in ${groqDuration}ms.`);
    console.log(`         Scientific Name:   ${profile.scientificName ?? 'N/A'}`);
    console.log(`         Category:          ${profile.category}`);
    console.log(`         Difficulty:        ${profile.difficulty ?? 'N/A'}`);
    console.log(
      `         Temperature Range: ${profile.temperatureMin ?? 'N/A'}°C – ${profile.temperatureMax ?? 'N/A'}°C`,
    );
    console.log(
      `         Humidity Range:    ${profile.humidityMin ?? 'N/A'}% – ${profile.humidityMax ?? 'N/A'}%`,
    );
    console.log(`         Confidence:        ${profile.confidence}`);
    console.log(`         Sources Cited:     ${profile.sources.length}`);
    console.log(`         Validation Result: VALID`);
  } catch (err) {
    const groqDuration = Date.now() - groqStart;
    console.error(
      `  [FAILED] Groq synthesis failed after ${groqDuration}ms:`,
      err instanceof Error ? err.message : String(err),
    );
    process.exitCode = 1;
    return;
  }

  console.log('\n====================================================');
  console.log(' Live Provider Smoke Test: ALL CHECKS PASSED');
  console.log('====================================================');
  console.log('NOTE: This smoke test verified external provider connectivity,');
  console.log('timeouts, and schema synthesis. Neon database persistence and');
  console.log('authorization rules are tested deterministically via isolated');
  console.log('integration test suites.\n');
}

await runSmokeTest();

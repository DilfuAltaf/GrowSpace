import type { AssistantSource } from '@growspace/shared';
import { getSearchConfig } from '../env';
import { TavilySearchAdapter, extractPublisher } from '../research/search-adapter';
import { validateUrlForOutboundFetch } from '../research/ssrf-guard';

export interface WebResearchResult {
  needed: boolean;
  sources: AssistantSource[];
  evidenceText: string;
}

const BOTANICAL_RESEARCH_TRIGGERS = [
  'how to',
  'how do i',
  'pest',
  'disease',
  'fungus',
  'yellow leaves',
  'blight',
  'mildew',
  'rot',
  'bug',
  'aphid',
  'spider mite',
  'fertiliz',
  'prun',
  'companion',
  'soil mix',
  'propagation',
  'cutting',
  'pollinat',
  'harvest sign',
  'overwinter',
  'sunlight requirement',
  'temperature requirement',
];

const LOCAL_DATA_ONLY_TRIGGERS = [
  'my plant',
  'my garden',
  'my task',
  'my reading',
  'need attention',
  'prioritize today',
  'tasks today',
  'overdue',
  'moisture changed',
  'latest reading',
  'this week',
];

/**
 * Determines whether a user query genuinely warrants external web research.
 */
export function shouldPerformWebResearch(query: string): boolean {
  const normalized = query.toLowerCase().trim();

  // If query is very short or is purely about local telemetry/tasks, don't search
  if (normalized.length < 8) return false;

  const isLocalLookup = LOCAL_DATA_ONLY_TRIGGERS.some((t) => normalized.includes(t));
  const hasBotanicalQuestion = BOTANICAL_RESEARCH_TRIGGERS.some((t) => normalized.includes(t));

  // If asking general cultivation question or specific horticultural technique
  if (hasBotanicalQuestion && !isLocalLookup) {
    return true;
  }

  // If asking "what causes...", "why are...", "how can I treat..."
  if (
    normalized.startsWith('why') ||
    normalized.startsWith('what causes') ||
    normalized.startsWith('how to treat')
  ) {
    return true;
  }

  return false;
}

/**
 * Performs sanitized, SSRF-guarded web research for the AI assistant.
 * Returns empty gracefully if search provider is unconfigured or fails.
 */
export async function performAssistantWebResearch(
  query: string,
  plantContextName?: string,
): Promise<WebResearchResult> {
  const needed = shouldPerformWebResearch(query);
  if (!needed) {
    return { needed: false, sources: [], evidenceText: '' };
  }

  const searchCfg = getSearchConfig();
  if (!searchCfg || searchCfg.provider !== 'tavily' || !searchCfg.apiKey) {
    return { needed: true, sources: [], evidenceText: '' };
  }

  try {
    const adapter = new TavilySearchAdapter(searchCfg.apiKey);
    const searchSubject = plantContextName
      ? `${plantContextName} ${query.slice(0, 80)}`
      : query.slice(0, 100);

    const rawResults = await adapter.search(searchSubject, { maxResults: 3 });
    const validatedSources: AssistantSource[] = [];
    const evidenceSnippets: string[] = [];

    for (const item of rawResults) {
      const urlCheck = await validateUrlForOutboundFetch(item.url);
      if (!urlCheck.valid) continue;

      const publisher = item.publisher || extractPublisher(item.url);
      validatedSources.push({
        title: item.title,
        url: item.url,
        publisher,
        snippet: item.snippet,
      });

      evidenceSnippets.push(
        `[Source: ${publisher} - ${item.title}]\nURL: ${item.url}\nExcerpt: ${item.snippet}`,
      );
    }

    if (validatedSources.length === 0) {
      return { needed: true, sources: [], evidenceText: '' };
    }

    return {
      needed: true,
      sources: validatedSources,
      evidenceText: evidenceSnippets.join('\n\n'),
    };
  } catch (err) {
    console.warn('[AssistantResearch] Tavily web research failed, continuing without web data:', err);
    return { needed: true, sources: [], evidenceText: '' };
  }
}

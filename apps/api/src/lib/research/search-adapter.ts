import { getSearchConfig } from '../env';
import { validateUrlForOutboundFetch } from './ssrf-guard';

export interface SearchEvidenceItem {
  title: string;
  url: string;
  publisher?: string | null;
  snippet: string;
  retrievedAt: string;
}

export interface SearchAdapter {
  readonly name: string;
  search(plantName: string, options?: { maxResults?: number }): Promise<SearchEvidenceItem[]>;
}

/**
 * Extracts a friendly publisher label from a URL (e.g. extension.umn.edu -> UMN Extension)
 */
export function extractPublisher(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('extension.')) {
      const parts = host.split('.');
      return `${parts[1]?.toUpperCase() ?? ''} Extension`;
    }
    if (host.endsWith('.edu')) {
      return host.replace(/\.edu$/, ' University');
    }
    if (host.includes('rhs.org.uk')) {
      return 'Royal Horticultural Society (RHS)';
    }
    if (host.includes('usda.gov')) {
      return 'USDA';
    }
    if (host.endsWith('.gov')) {
      return 'Government Agriculture';
    }
    return host;
  } catch {
    return 'Horticultural Reference';
  }
}

/**
 * Tavily Search API Provider
 * Purpose-built for AI agents and LLM research workflows.
 */
export class TavilySearchAdapter implements SearchAdapter {
  readonly name = 'tavily';

  constructor(private readonly apiKey: string) {}

  async search(plantName: string, options: { maxResults?: number } = {}): Promise<SearchEvidenceItem[]> {
    const maxResults = options.maxResults ?? 5;
    const query = `${plantName} plant cultivation growing guide care conditions soil temperature`;

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: 'basic',
          max_results: maxResults,
          include_answer: false,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Search provider rate limit reached. Please try again in a few minutes.');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error('Search provider authentication failed. Check your API key.');
        }
        throw new Error(`Search provider returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };

      const items: SearchEvidenceItem[] = [];
      const now = new Date().toISOString();

      for (const res of data.results ?? []) {
        if (!res.url || !res.title) continue;

        // Verify URL passes SSRF checks
        const check = await validateUrlForOutboundFetch(res.url);
        if (!check.valid) continue;

        items.push({
          title: res.title.trim(),
          url: res.url.trim(),
          publisher: extractPublisher(res.url),
          snippet: (res.content ?? '').trim().slice(0, 1500),
          retrievedAt: now,
        });
      }

      return items;
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error('Search provider timed out after 12 seconds.', { cause: err });
      }
      throw err;
    }
  }
}

/**
 * Brave Search API Provider
 * Alternative privacy-focused web search API.
 */
export class BraveSearchAdapter implements SearchAdapter {
  readonly name = 'brave';

  constructor(private readonly apiKey: string) {}

  async search(plantName: string, options: { maxResults?: number } = {}): Promise<SearchEvidenceItem[]> {
    const count = options.maxResults ?? 5;
    const query = encodeURIComponent(
      `${plantName} plant cultivation care guide temperature humidity soil`,
    );

    try {
      const response = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${query}&count=${count}`,
        {
          headers: {
            Accept: 'application/json',
            'X-Subscription-Token': this.apiKey,
          },
          signal: AbortSignal.timeout(12000),
        },
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Search provider rate limit reached. Please try again later.');
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error('Search provider authentication failed. Check your API key.');
        }
        throw new Error(`Brave search returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        web?: {
          results?: Array<{
            title?: string;
            url?: string;
            description?: string;
            extra_snippets?: string[];
          }>;
        };
      };

      const items: SearchEvidenceItem[] = [];
      const now = new Date().toISOString();

      for (const r of data.web?.results ?? []) {
        if (!r.url || !r.title) continue;

        const check = await validateUrlForOutboundFetch(r.url);
        if (!check.valid) continue;

        const snippet = [r.description, ...(r.extra_snippets ?? [])]
          .filter(Boolean)
          .join(' ')
          .slice(0, 1500);

        items.push({
          title: r.title.trim(),
          url: r.url.trim(),
          publisher: extractPublisher(r.url),
          snippet,
          retrievedAt: now,
        });
      }

      return items;
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new Error('Search provider timed out after 12 seconds.', { cause: err });
      }
      throw err;
    }
  }
}

let searchAdapterOverride: SearchAdapter | null = null;

export function setSearchAdapterOverride(adapter: SearchAdapter | null): void {
  searchAdapterOverride = adapter;
}

export function getSearchAdapter(): SearchAdapter | null {
  if (searchAdapterOverride) {
    return searchAdapterOverride;
  }

  const config = getSearchConfig();
  if (!config) return null;

  if (config.provider === 'brave') {
    return new BraveSearchAdapter(config.apiKey);
  }
  return new TavilySearchAdapter(config.apiKey);
}

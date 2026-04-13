import type { NextRequest } from 'next/server';

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text' | 'api',
  content: string,
  url: string,
  title?: string,
};

// Helper: same search implementation as MCP / backend docs tools (internal HTTP API)
async function callDocsToolsSearch(search_query: string, requestOrigin: string): Promise<SearchResult[]> {
  try {
    const response = await fetch(`${requestOrigin}/api/internal/docs-tools`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'search_docs',
        search_query,
        result_limit: 20,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`docs-tools error (${response.status}):`, errorText);
      throw new Error(`docs-tools error: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    const jsonData = (await response.json()) as { content?: Array<{ type: string, text?: string }> };

    const searchResultText = jsonData.content?.[0]?.text || '';
    if (searchResultText.includes('No results found')) {
      return [];
    }

    const results: SearchResult[] = [];
    const resultBlocks = searchResultText.split('\n---\n');

    for (const block of resultBlocks) {
      const lines = block.trim().split('\n');
      let title = '';
      let description = '';
      let url = '';
      let type = '';
      let snippet = '';

      for (const line of lines) {
        if (line.startsWith('Title: ')) {
          title = line.substring(7);
        } else if (line.startsWith('Description: ')) {
          description = line.substring(13);
        } else if (line.startsWith('Documentation URL: ')) {
          url = line.substring(19);
        } else if (line.startsWith('URL: ')) {
          // Fallback for old format
          url = line.substring(5);
        } else if (line.startsWith('Type: ')) {
          type = line.substring(6);
        } else if (line.startsWith('Snippet: ')) {
          snippet = line.substring(9);
        }
      }

      if (title && url) {
        results.push({
          id: `${url}-${type}`,
          type: type === 'api' ? 'api' : 'page',
          content: snippet || description || title,
          url: url,
          title: title,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('docs-tools search failed:', error);
    // Fallback to empty results
    return [];
  }
}

// Helper function to get platform priority for tie-breaking
function getPlatformPriority(url: string): number {
  // Higher number = higher priority
  if (url.includes('/api/')) return 100; // API docs get highest priority
  if (url.includes('/docs/next/')) return 90;
  if (url.includes('/docs/react/')) return 80;
  if (url.includes('/docs/js/')) return 70;
  if (url.includes('/docs/python/')) return 60;
  return 50; // Default priority
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const search_query = searchParams.get('q');

  console.log('Search API called with query:', search_query);

  if (!search_query) {
    return Response.json([]);
  }

  try {
    const origin = new URL(request.url).origin;
    const results = await callDocsToolsSearch(search_query, origin);

    console.log(`Found ${results.length} search results from docs-tools for "${search_query}"`);

    // Filter out admin API endpoints as an additional safety measure
    const filteredResults = results.filter(result => !result.url.startsWith('/api/admin'));

    // Sort by platform priority since docs-tools already handles relevance
    const sortedResults = filteredResults.sort((a, b) => {
      return getPlatformPriority(b.url) - getPlatformPriority(a.url);
    });

    console.log(`\n=== DOCS SEARCH RESULTS FOR "${search_query}" ===`);
    sortedResults.slice(0, 10).forEach((result, i) => {
      const priority = getPlatformPriority(result.url);
      console.log(`${i + 1}. "${result.content}" (${result.type}) - Priority: ${priority} - URL: ${result.url}`);
    });

    return Response.json(sortedResults);

  } catch (error) {
    console.error('Search error:', error);
    return Response.json({ error: 'Search failed', details: String(error) }, { status: 500 });
  }
}

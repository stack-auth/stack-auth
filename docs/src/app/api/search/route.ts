import type { NextRequest } from 'next/server';

type SearchResult = {
  id: string,
  type: 'page' | 'heading' | 'text' | 'api',
  content: string,
  url: string,
  title?: string,
};

// Helper function to call MCP server
async function callMcpServer(search_query: string): Promise<SearchResult[]> {
  try {
    // Use localhost during development, production URL otherwise
    const mcpUrl = process.env.NODE_ENV === 'development'
      ? 'http://localhost:8104/api/internal/mcp'
      : 'https://mcp.stack-auth.com/api/internal/mcp';

    console.log(`Calling MCP server at: ${mcpUrl}`);

    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: 'search_docs',
          arguments: { search_query, result_limit: 20 },
        },
        id: Date.now(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`MCP server error (${response.status}):`, errorText);
      throw new Error(`MCP server error: ${response.status} - ${errorText.substring(0, 200)}`);
    }

    // Parse Server-Sent Events format response
    // Read the stream until we get the data event (don't wait for connection to close)
    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let jsonData = null;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          // Look for complete data: lines in the buffer
          const lines = buffer.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                jsonData = JSON.parse(line.substring(6));
                // Found our data, we can stop reading
                await reader.cancel();
                break;
              } catch (e) {
                // Continue looking for valid JSON data
              }
            }
          }

          if (jsonData) break;
        }

        if (done) break;
      }
    } finally {
      reader.releaseLock();
    }

    if (!jsonData) {
      throw new Error('Invalid MCP response format');
    }

    if (jsonData.error) {
      throw new Error(jsonData.error.message || 'MCP search failed');
    }

    // Parse the search results from the text response
    const searchResultText = jsonData.result?.content?.[0]?.text || '';
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
    console.error('MCP server call failed:', error);
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
    // Call MCP server for search results
    const results = await callMcpServer(search_query);

    console.log(`Found ${results.length} search results from MCP server for "${search_query}"`);

    // Filter out admin API endpoints as an additional safety measure
    const filteredResults = results.filter(result => !result.url.startsWith('/api/admin'));

    // Sort by platform priority since MCP server already handles relevance
    const sortedResults = filteredResults.sort((a, b) => {
      return getPlatformPriority(b.url) - getPlatformPriority(a.url);
    });

    console.log(`\n=== MCP SEARCH RESULTS FOR "${search_query}" ===`);
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

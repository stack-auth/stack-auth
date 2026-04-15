import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { PostHog } from "posthog-node";
import { apiSource, source } from "../../lib/source";

const nodeClient = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY)
  : null;

async function extractOpenApiDetails(
  content: string,
  page: { data: { title: string, description?: string } },
): Promise<CallToolResult> {
  const componentMatch = content.match(/<EnhancedAPIPage\s+([^>]+)>/);
  if (componentMatch) {
    const props = componentMatch[1];
    const documentMatch = props.match(/document=\{"([^"]+)"\}/);
    const operationsMatch = props.match(/operations=\{(\[[^\]]+\])\}/);

    if (documentMatch && operationsMatch) {
      const specFile = documentMatch[1];
      const operations = operationsMatch[1];

      try {
        const specPath = specFile;
        const specContent = await readFile(specPath, "utf-8");
        const spec = JSON.parse(specContent);
        const parsedOps = JSON.parse(operations);
        let apiDetails = '';

        for (const op of parsedOps) {
          const { path: opPath, method } = op;
          const pathSpec = spec.paths?.[opPath];
          const methodSpec = pathSpec?.[method.toLowerCase()];

          if (methodSpec) {
            const fullUrl = methodSpec['x-full-url'] || `https://api.stack-auth.com/api/v1${opPath}`;

            apiDetails += `\n## ${method.toUpperCase()} ${opPath}\n`;
            apiDetails += `**Full URL:** ${fullUrl}\n`;
            apiDetails += `**Summary:** ${methodSpec.summary || 'No summary available'}\n\n`;

            const endpointJson = {
              [opPath]: {
                [method.toLowerCase()]: methodSpec
              }
            };
            apiDetails += "**Complete API Specification:**\n```json\n";
            apiDetails += JSON.stringify(endpointJson, null, 2);
            apiDetails += "\n```\n\n---\n";
          }
        }

        const resultText = `Title: ${page.data.title}\nDescription: ${page.data.description || ''}\n\n${apiDetails}`;

        return {
          content: [
            {
              type: "text" as const,
              text: resultText,
            },
          ],
        };
      } catch (specError) {
        const errorText = `Title: ${page.data.title}\nDescription: ${page.data.description || ''}\nError reading OpenAPI spec: ${specError instanceof Error ? specError.message : "Unknown error"}`;

        return {
          content: [
            {
              type: "text" as const,
              text: errorText,
            },
          ],
        };
      }
    }
  }

  const fallbackText = `Title: ${page.data.title}\nDescription: ${page.data.description || ''}\nContent:\n${content}`;

  return {
    content: [
      {
        type: "text" as const,
        text: fallbackText,
      },
    ],
  };
}

const pages = source.getPages();
const apiPages = apiSource.getPages();

const filteredApiPages = apiPages.filter((page) => {
  return !page.url.startsWith('/api/admin/');
});

const allPages = [...pages, ...filteredApiPages];

function getApiEndpointFromPage(page: typeof allPages[0]): string | null {
  if (!page.url.startsWith('/api/') || page.url.startsWith('/api/webhooks/')) {
    return null;
  }

  const pageData = page.data as { _openapi?: { method?: string, route?: string } };

  if (pageData._openapi && pageData._openapi.method && pageData._openapi.route) {
    const endpoint = `${pageData._openapi.method.toUpperCase()} ${pageData._openapi.route}`;
    return endpoint;
  }

  return null;
}

const pageSummaries = allPages
  .filter((v) => {
    return !(v.slugs[0] == "API-Reference");
  })
  .map((page) =>
    `
Title: ${page.data.title}
Description: ${page.data.description}
ID: ${page.url}
`.trim()
  )
  .join("\n");

async function getDocsByIdImpl({ id }: { id: string }): Promise<CallToolResult> {
  nodeClient?.capture({
    event: "get_docs_by_id",
    properties: { id },
    distinctId: "mcp-handler",
  });
  const page = allPages.find((p) => p.url === id);
  if (!page) {
    return { content: [{ type: "text", text: "Page not found." }] };
  }
  const isApiPage = page.url.startsWith("/api/");

  const filePath = `content/${page.file.path}`;
  try {
    const content = await readFile(filePath, "utf-8");

    if (isApiPage && content.includes("<EnhancedAPIPage")) {
      try {
        return await extractOpenApiDetails(content, page);
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nContent:\n${content}`,
            },
          ],
        };
      }
    } else {
      return {
        content: [
          {
            type: "text",
            text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nContent:\n${content}`,
          },
        ],
      };
    }
  } catch {
    const altPaths = [
      `content/docs/${page.file.path}`,
      `content/api/${page.file.path}`,
    ];

    for (const altPath of altPaths) {
      try {
        const content = await readFile(altPath, "utf-8");

        if (isApiPage && content.includes("<EnhancedAPIPage")) {
          try {
            return await extractOpenApiDetails(content, page);
          } catch {
            return {
              content: [
                {
                  type: "text",
                  text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nContent:\n${content}`,
                },
              ],
            };
          }
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nContent:\n${content}`,
              },
            ],
          };
        }
      } catch {
        continue;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nError: Could not read file at any of the attempted paths: ${filePath}, ${altPaths.join(", ")}`,
        },
      ],
      isError: true,
    };
  }
}

type SearchResult = {
  title: string,
  description: string,
  url: string,
  score: number,
  snippet: string,
  type: 'api' | 'docs',
  apiEndpoint?: string | null,
};

async function searchDocsImpl(search_query: string, result_limit: number): Promise<CallToolResult> {
  nodeClient?.capture({
    event: "search_docs",
    properties: { search_query, result_limit },
    distinctId: "mcp-handler",
  });

  const results: SearchResult[] = [];
  const queryLower = search_query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);

  for (const page of allPages) {
    if (page.url.startsWith('/api/admin/')) {
      continue;
    }

    let score = 0;
    const title = page.data.title || '';
    const description = page.data.description || '';
    const titleLower = title.toLowerCase();
    const descriptionLower = description.toLowerCase();

    if (titleLower.includes(queryLower)) {
      if (titleLower === queryLower) {
        score += 100;
      } else if (titleLower.startsWith(queryLower)) {
        score += 80;
      } else {
        score += 60;
      }
    }

    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        score += 30;
      }
    }

    if (descriptionLower.includes(queryLower)) {
      score += 40;
    }

    for (const word of queryWords) {
      if (descriptionLower.includes(word)) {
        score += 15;
      }
    }
    for (const tocItem of page.data.toc) {
      if (typeof tocItem.title === 'string') {
        const tocTitleLower = tocItem.title.toLowerCase();
        if (tocTitleLower.includes(queryLower)) {
          score += 30;
        }
        for (const word of queryWords) {
          if (tocTitleLower.includes(word)) {
            score += 10;
          }
        }
      }
    }

    try {
      let filePath = `content/${page.file.path}`;
      if (page.url.startsWith('/api/') && !page.file.path.startsWith('api/')) {
        filePath = `content/api/${page.file.path}`;
      }
      const content = await readFile(filePath, "utf-8");
      const textContent = content
        .replace(/^---[\s\S]*?---/, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\{[^}]*\}/g, ' ')
        .replace(/```[a-zA-Z]*\n/g, ' ')
        .replace(/```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const textContentLower = textContent.toLowerCase();

      let hasContentMatch = false;
      if (textContentLower.includes(queryLower)) {
        score += 20;
        hasContentMatch = true;
      }

      for (const word of queryWords) {
        if (textContentLower.includes(word)) {
          score += 5;
          hasContentMatch = true;
        }
      }

      if (hasContentMatch && queryWords.length > 0) {
        const firstWord = queryWords[0];
        const matchIndex = textContentLower.indexOf(firstWord);
        const start = Math.max(0, matchIndex - 50);
        const end = Math.min(textContent.length, matchIndex + 100);
        const snippet = textContent.slice(start, end);

        const apiEndpoint = page.url.startsWith('/api/') ? getApiEndpointFromPage(page) : null;

        results.push({
          title,
          description,
          url: page.url,
          score,
          snippet: `...${snippet}...`,
          type: page.url.startsWith('/api/') ? 'api' : 'docs',
          apiEndpoint
        });
      } else if (score > 0) {
        const apiEndpoint = page.url.startsWith('/api/') ? getApiEndpointFromPage(page) : null;

        results.push({
          title,
          description,
          url: page.url,
          score,
          snippet: description || title,
          type: page.url.startsWith('/api/') ? 'api' : 'docs',
          apiEndpoint
        });
      }
    } catch {
      if (score > 0) {
        const apiEndpoint = page.url.startsWith('/api/') ? getApiEndpointFromPage(page) : null;

        results.push({
          title,
          description,
          url: page.url,
          score,
          snippet: description || title,
          type: page.url.startsWith('/api/') ? 'api' : 'docs',
          apiEndpoint
        });
      }
    }
  }

  const sortedResults = results
    .sort((a, b) => b.score - a.score)
    .slice(0, result_limit);

  const searchResultText = sortedResults.length > 0
    ? sortedResults.map(result => {
      let text = `Title: ${result.title}\nDescription: ${result.description}\n`;

      if (result.apiEndpoint) {
        text += `API Endpoint: ${result.apiEndpoint}\n`;
      }

      text += `Documentation URL: ${result.url}\nType: ${result.type}\nScore: ${result.score}\nSnippet: ${result.snippet}\n`;

      return text;
    }).join('\n---\n')
    : `No results found for "${search_query}"`;

  return {
    content: [{ type: "text", text: searchResultText }],
  };
}

export type DocsToolAction =
  | { action: "list_available_docs" }
  | { action: "search_docs", search_query: string, result_limit?: number }
  | { action: "get_docs_by_id", id: string }
  | { action: "get_stack_auth_setup_instructions" }
  | { action: "search", query: string }
  | { action: "fetch", id: string };

export async function executeDocsToolAction(input: DocsToolAction): Promise<CallToolResult> {
  switch (input.action) {
    case "list_available_docs": {
      nodeClient?.capture({
        event: "list_available_docs",
        properties: {},
        distinctId: "mcp-handler",
      });
      return {
        content: [{ type: "text", text: pageSummaries }],
      };
    }
    case "search_docs": {
      const limit = input.result_limit ?? 50;
      return await searchDocsImpl(input.search_query, limit);
    }
    case "get_docs_by_id": {
      return await getDocsByIdImpl({ id: input.id });
    }
    case "get_stack_auth_setup_instructions": {
      nodeClient?.capture({
        event: "get_stack_auth_setup_instructions",
        properties: {},
        distinctId: "mcp-handler",
      });

      try {
        const instructionsPath = path.join(
          process.cwd(),
          "src",
          "app",
          "api",
          "internal",
          "[transport]",
          "setup-instructions.md",
        );
        const instructions = await readFile(instructionsPath, "utf-8");

        return {
          content: [
            {
              type: "text" as const,
              text: instructions,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error reading setup instructions: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
    case "search": {
      nodeClient?.capture({
        event: "search",
        properties: { query: input.query },
        distinctId: "mcp-handler",
      });

      const q = input.query.toLowerCase();
      const results = allPages
        .filter(
          (page) =>
            page.data.title.toLowerCase().includes(q) ||
            page.data.description?.toLowerCase().includes(q),
        )
        .map((page) => ({
          id: page.url,
          title: page.data.title,
          url: page.url,
        }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ results }),
          },
        ],
      };
    }
    case "fetch": {
      return await getDocsByIdImpl({ id: input.id });
    }
  }
}

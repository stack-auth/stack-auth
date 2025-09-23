import { createMcpHandler } from "@vercel/mcp-adapter";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { apiSource, source } from "../../../../../lib/source";

import { PostHog } from "posthog-node";

const nodeClient = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY)
  : null;

// Helper function to extract OpenAPI details from Enhanced API Page content
async function extractOpenApiDetails(content: string, page: { data: { title: string, description?: string } }) {

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
            // Add human-readable summary first
            const fullUrl = methodSpec['x-full-url'] || `https://api.stack-auth.com/api/v1${opPath}`;

            apiDetails += `\n## ${method.toUpperCase()} ${opPath}\n`;
            apiDetails += `**Full URL:** ${fullUrl}\n`;
            apiDetails += `**Summary:** ${methodSpec.summary || 'No summary available'}\n\n`;

            // Then include the complete OpenAPI spec with all examples and schemas
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

  // If no component match or missing props, return regular content
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

// Get pages from both main docs and API docs
const pages = source.getPages();
const apiPages = apiSource.getPages();

// Filter out admin API pages from the MCP server
const filteredApiPages = apiPages.filter((page) => {
  // Exclude admin API pages - they should not be accessible via MCP
  return !page.url.startsWith('/api/admin/');
});

const allPages = [...pages, ...filteredApiPages];

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

const handler = createMcpHandler(
  async (server) => {
    server.tool(
      "list_available_docs",
      "Use this tool to learn about what Stack Auth is, available documentation, and see if you can use it for what you're working on. It returns a list of all available Stack Auth Documentation pages.",
      {},
      async ({}) => {
        nodeClient?.capture({
          event: "list_available_docs",
          properties: {},
          distinctId: "mcp-handler",
        });
        return {
          content: [{ type: "text", text: pageSummaries }],
        };
      }
    );
    server.tool(
      "search_docs", 
      "Search through all Stack Auth documentation including API docs, guides, and examples. Returns ranked results with snippets and relevance scores.",
      {
        search_query: z.string().describe("The search query to find relevant documentation"),
        result_limit: z.number().optional().describe("Maximum number of results to return (default: 50)")
      },
      async ({ search_query, result_limit = 50 }) => {
        nodeClient?.capture({
          event: "search_docs",
          properties: { search_query, result_limit },
          distinctId: "mcp-handler",
        });

        const results = [];
        const queryLower = search_query.toLowerCase().trim();

        // Search through all pages
        for (const page of allPages) {
          // Skip admin API endpoints
          if (page.url.startsWith('/api/admin/')) {
            continue;
          }

          let score = 0;
          const title = page.data.title || '';
          const description = page.data.description || '';

          // Title matching (highest priority)
          if (title.toLowerCase().includes(queryLower)) {
            if (title.toLowerCase() === queryLower) {
              score += 100; // Exact match
            } else if (title.toLowerCase().startsWith(queryLower)) {
              score += 80; // Starts with
            } else {
              score += 60; // Contains
            }
          }

          // Description matching
          if (description.toLowerCase().includes(queryLower)) {
            score += 40;
          }
          // TOC/heading matching
          for (const tocItem of page.data.toc) {
            if (typeof tocItem.title === 'string' && tocItem.title.toLowerCase().includes(queryLower)) {
              score += 30;
            }
          }

          // Content matching (try to read the actual file)
          try {
            const filePath = `content/${page.file.path}`;
            const content = await readFile(filePath, "utf-8");
            const textContent = content
              .replace(/^---[\s\S]*?---/, '') // Remove frontmatter
              .replace(/<[^>]*>/g, ' ') // Remove JSX tags
              .replace(/\{[^}]*\}/g, ' ') // Remove JSX expressions
              .replace(/```[a-zA-Z]*\n/g, ' ') // Remove code block markers
              .replace(/```/g, ' ')
              .replace(/`([^`]*)`/g, '$1') // Remove inline code backticks
              .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // Extract link text
              .replace(/[#*_~]/g, '') // Remove markdown formatting
              .replace(/\s+/g, ' ')
              .trim();

            if (textContent.toLowerCase().includes(queryLower)) {
              score += 20;

              // Find snippet around the match
              const matchIndex = textContent.toLowerCase().indexOf(queryLower);
              const start = Math.max(0, matchIndex - 50);
              const end = Math.min(textContent.length, matchIndex + 100);
              const snippet = textContent.slice(start, end);

              results.push({
                title,
                description,
                url: page.url,
                score,
                snippet: `...${snippet}...`,
                type: page.url.startsWith('/api/') ? 'api' : 'docs'
              });
            } else if (score > 0) {
              // Add without snippet if title/description matched
              results.push({
                title,
                description,
                url: page.url,
                score,
                snippet: description || title,
                type: page.url.startsWith('/api/') ? 'api' : 'docs'
              });
            }
          } catch {
            // If file reading fails but we have title/description matches
            if (score > 0) {
              results.push({
                title,
                description,
                url: page.url,
                score,
                snippet: description || title,
                type: page.url.startsWith('/api/') ? 'api' : 'docs'
              });
            }
          }
        }

        // Sort by score (highest first) and limit results
        const sortedResults = results
          .sort((a, b) => b.score - a.score)
          .slice(0, result_limit);

        const searchResultText = sortedResults.length > 0
          ? sortedResults.map(result =>
              `Title: ${result.title}\nDescription: ${result.description}\nURL: ${result.url}\nType: ${result.type}\nScore: ${result.score}\nSnippet: ${result.snippet}\n`
            ).join('\n---\n')
          : `No results found for "${search_query}"`;

        return {
          content: [{ type: "text", text: searchResultText }],
        };
      }
    );
    server.tool(
      "get_docs_by_id",
      "Use this tool to retrieve a specific Stack Auth Documentation page by its ID. It gives you the full content of the page so you can know exactly how to use specific Stack Auth APIs. Whenever using Stack Auth, you should always check the documentation first to have the most up-to-date information. When you write code using Stack Auth documentation you should reference the content you used in your comments.",
      { id: z.string() },
      async ({ id }) => {
        nodeClient?.capture({
          event: "get_docs_by_id",
          properties: { id },
          distinctId: "mcp-handler",
        });
        const page = allPages.find((page) => page.url === id);
        if (!page) {
          return { content: [{ type: "text", text: "Page not found." }] };
        }
        // Check if this is an API page and handle OpenAPI spec extraction
        const isApiPage = page.url.startsWith('/api/');

        // Try primary path first, then fallback to docs/ prefix or api/ prefix
        const filePath = `content/${page.file.path}`;
        try {
          const content = await readFile(filePath, "utf-8");

          if (isApiPage && content.includes('<EnhancedAPIPage')) {
            // Extract OpenAPI information from API pages
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
            // Regular doc page - return content as before
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
          // Try alternative paths
          const altPaths = [
            `content/docs/${page.file.path}`,
            `content/api/${page.file.path}`,
          ];

          for (const altPath of altPaths) {
            try {
              const content = await readFile(altPath, "utf-8");

              if (isApiPage && content.includes('<EnhancedAPIPage')) {
                // Same OpenAPI extraction logic for alternative path
                try {
                  return await extractOpenApiDetails(content, page);
                } catch {
                  // If parsing fails, return the raw content
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
              // Continue to next path
              continue;
            }
          }

          // If all paths fail
          return {
            content: [
              {
                type: "text",
                text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nError: Could not read file at any of the attempted paths: ${filePath}, ${altPaths.join(', ')}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
    server.tool(
      "get_stack_auth_setup_instructions",
      "Use this tool when the user wants to set up authentication in a new project. It provides step-by-step instructions for installing and configuring Stack Auth authentication.",
      {},
      async ({}) => {
        nodeClient?.capture({
          event: "get_stack_auth_setup_instructions",
          properties: {},
          distinctId: "mcp-handler",
        });

        try {
          const instructionsPath = "content/setup-instructions.md";
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
    );
  },
  {
    capabilities: {
      tools: {
        listAvailableDocs: {
          description:
            "Use this tool to learn about what Stack Auth is, available documentation, and see if you can use it for what you're working on. It returns a list of all available Stack Auth Documentation pages.",
        },
        getDocById: {
          description:
            "Use this tool to retrieve a specific Stack Auth Documentation page by its ID. It gives you the full content of the page so you can know exactly how to use specific Stack Auth APIs. Whenever using Stack Auth, you should always check the documentation first to have the most up-to-date information. When you write code using Stack Auth documentation you should reference the content you used in your comments.",
          parameters: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "The ID of the documentation page to retrieve.",
              },
            },
            required: ["id"],
          },
        },
        getStackAuthSetupInstructions: {
          description:
            "Use this tool when the user wants to set up Stack Auth in a new project. It provides step-by-step instructions for installing and configuring Stack Auth authentication, including environment setup, file scaffolding, and verification steps.",
          parameters: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
    },
  },
  {
    basePath: "/api/internal",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as DELETE, handler as GET, handler as POST };

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
            // Return the raw OpenAPI spec JSON for this specific endpoint
            const endpointJson = {
              [opPath]: {
                [method.toLowerCase()]: methodSpec
              }
            };
            apiDetails += JSON.stringify(endpointJson, null, 2);
          }
        }

        const resultText = `Title: ${page.data.title}\nDescription: ${page.data.description || ''}\n\nOpenAPI Spec: ${specFile}\nOperations: ${operations}\n\n${apiDetails}`;

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
const allPages = [...pages, ...apiPages];

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

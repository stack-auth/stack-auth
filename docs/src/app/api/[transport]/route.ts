import { createMcpHandler } from "@vercel/mcp-adapter";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { apiSource, source } from "../../../../lib/source";

import { PostHog } from "posthog-node";

const nodeClient = process.env.NEXT_PUBLIC_POSTHOG_KEY
  ? new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY)
  : null;

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
      "listAvailableDocs",
      "Use this tool to learn about what Stack Auth is, available documentation, and see if you can use it for what you're working on. It returns a list of all available Stack Auth Documentation pages.",
      {},
      async ({}) => {
        nodeClient?.capture({
          event: "listAvailableDocs",
          properties: {},
          distinctId: "mcp-handler",
        });
        return {
          content: [{ type: "text", text: pageSummaries }],
        };
      }
    );
    server.tool(
      "getDocById",
      "Use this tool to retrieve a specific Stack Auth Documentation page by its ID. It gives you the full content of the page so you can know exactly how to use specific Stack Auth APIs. Whenever using Stack Auth, you should always check the documentation first to have the most up-to-date information. When you write code using Stack Auth documentation you should reference the content you used in your comments.",
      { id: z.string() },
      async ({ id }) => {
        nodeClient?.capture({
          event: "getDocById",
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
          const content = readFileSync(filePath, "utf-8");

          if (isApiPage && content.includes('<EnhancedAPIPage')) {
            // Extract OpenAPI information from API pages
            try {
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
                    const specContent = readFileSync(specPath, "utf-8");
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

                    return {
                      content: [
                        {
                          type: "text",
                          text: `Title: ${page.data.title}\nDescription: ${page.data.description}\n\nOpenAPI Spec: ${specFile}\nOperations: ${operations}\n\n${apiDetails}`,
                        },
                      ],
                    };
                  } catch (specError) {
                    return {
                      content: [
                        {
                          type: "text",
                          text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nError reading OpenAPI spec: ${specError instanceof Error ? specError.message : "Unknown error"}`,
                        },
                      ],
                    };
                  }
                }
              }

              return {
                content: [
                  {
                    type: "text",
                    text: `Title: ${page.data.title}\nDescription: ${page.data.description}\nContent:\n${content}`,
                  },
                ],
              };
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
              const content = readFileSync(altPath, "utf-8");

              if (isApiPage && content.includes('<EnhancedAPIPage')) {
                // Same OpenAPI extraction logic for alternative path
                try {
                  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                  let openApiInfo = '';

                  if (frontmatterMatch) {
                    const frontmatter = frontmatterMatch[1];
                    const openApiMatch = frontmatter.match(/_openapi:\s*\n((?:\s{2}.*\n?)*)/);
                    if (openApiMatch) {
                      openApiInfo += "OpenAPI Metadata:\n" + openApiMatch[0] + "\n\n";
                    }
                  }

                  const componentMatch = content.match(/<EnhancedAPIPage\s+([^>]+)>/);
                  if (componentMatch) {
                    const props = componentMatch[1];
                    const documentMatch = props.match(/document=\{"([^"]+)"\}/);
                    const operationsMatch = props.match(/operations=\{(\[[^\]]+\])\}/);

                    if (documentMatch && operationsMatch) {
                      const specFile = documentMatch[1];
                      const operations = operationsMatch[1];

                      openApiInfo += `OpenAPI Spec File: ${specFile}\n`;
                      openApiInfo += `Operations: ${operations}\n\n`;

                      try {
                        const specPath = specFile;
                        const specContent = readFileSync(specPath, "utf-8");
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

                        return {
                          content: [
                            {
                              type: "text",
                              text: `Title: ${page.data.title}\nDescription: ${page.data.description}\n\n${openApiInfo}${apiDetails}`,
                            },
                          ],
                        };
                      } catch (specError) {
                        return {
                          content: [
                            {
                              type: "text",
                              text: `Title: ${page.data.title}\nDescription: ${page.data.description}\n\n${openApiInfo}Error reading OpenAPI spec: ${specError instanceof Error ? specError.message : "Unknown error"}`,
                            },
                          ],
                        };
                      }
                    }
                  }

                  return {
                    content: [
                      {
                        type: "text",
                        text: `Title: ${page.data.title}\nDescription: ${page.data.description}\n\n${openApiInfo}Raw Content:\n${content}`,
                      },
                    ],
                  };
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
    basePath: "/api",
    verboseLogs: true,
    maxDuration: 60,
  }
);

export { handler as DELETE, handler as GET, handler as POST };

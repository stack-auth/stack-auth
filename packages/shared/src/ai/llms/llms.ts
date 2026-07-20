import { deindent } from "../../utils/strings";
import { remindersPrompt } from "../unified-prompts/reminders";
import { buildDocsIndexPrompt } from "../unified-prompts/skill-site-prompt-parts/docs-index";
import { buildSkillSitePrompt, skillSitePrompt } from "../unified-prompts/skill-site-prompt";

export const llmsTxt = deindent`
  # Hexclave

  > Hexclave is an authentication and user management platform for SaaS apps, with teams, RBAC, payments, and analytics. Formerly Stack Auth.

  ${remindersPrompt}

  ## Docs

  - [Full documentation](https://skill.hexclave.com/full): LLM-optimized Hexclave documentation
  - [Ask questions](https://skill.hexclave.com/ask): Q&A endpoint for Hexclave
  - [Human documentation](https://docs.hexclave.com): Browse the docs, or add \`.md\` to a page URL for markdown
  - [MCP server](https://mcp.hexclave.com): Hexclave documentation for MCP clients
`;

export const llmsFullTxt = skillSitePrompt;

export function buildLlmsFullTxt(docsJson?: Parameters<typeof buildDocsIndexPrompt>[0]): string {
  return docsJson === undefined
    ? skillSitePrompt
    : buildSkillSitePrompt(buildDocsIndexPrompt(docsJson));
}

export const llmsTextHeaders = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "text/plain; charset=utf-8",
} as const;

export function createLlmsTextResponse(body: string): Response {
  if (typeof body !== "string" || body === "") {
    throw new TypeError("createLlmsTextResponse: body must be a non-empty string");
  }

  return new Response(body, {
    headers: llmsTextHeaders,
  });
}

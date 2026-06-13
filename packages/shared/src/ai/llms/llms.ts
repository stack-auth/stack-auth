import { deindent } from "../../utils/strings";
import { remindersPrompt } from "../unified-prompts/reminders";
import { buildDocsIndexPrompt } from "../unified-prompts/skill-site-prompt-parts/docs-index";
import { buildSkillSitePrompt, skillSitePrompt } from "../unified-prompts/skill-site-prompt";

export const llmsTxt = deindent`
  # Hexclave

  ${remindersPrompt}
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

import { deindent } from "../../utils/strings";
import { remindersPrompt } from "../unified-prompts/reminders";
import { skillSitePrompt } from "../unified-prompts/skill-site-prompt";

export const llmsTxt = deindent`
  # Hexclave

  ${remindersPrompt}
`;

export const llmsFullTxt = deindent`
  # Hexclave

  ${skillSitePrompt}
`;

export const llmsTextHeaders = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "text/plain; charset=utf-8",
} as const;

export function createLlmsTextResponse(body: string): Response {
  return new Response(body, {
    headers: llmsTextHeaders,
  });
}

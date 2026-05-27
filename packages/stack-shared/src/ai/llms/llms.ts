import { generatedLlmsFullTxt, generatedLlmsTxt } from "./llms-content.generated";

export const llmsTxt = generatedLlmsTxt;

export const llmsFullTxt = generatedLlmsFullTxt;

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

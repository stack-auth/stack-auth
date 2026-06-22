import { skillSitePrompt } from "../../../../../packages/shared/src/ai/unified-prompts/skill-site-prompt";

const COMMON_HEADERS = {
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
} as const;

export function GET() {
  return new Response(skillSitePrompt, {
    headers: {
      ...COMMON_HEADERS,
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}

export function HEAD() {
  return GET();
}

export function OPTIONS() {
  return new Response(null, {
    headers: COMMON_HEADERS,
  });
}

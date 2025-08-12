import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { NextRequest } from "next/server";

export async function GET({}: NextRequest) {
  const robotsContent = deindent`
    User-agent: *
    Allow: /
  `;

  return new Response(robotsContent, {
    headers: {
      "Content-Type": "text/plain",
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    },
  });
}

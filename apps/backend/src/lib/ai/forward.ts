import { type RequestBody } from "@/lib/ai/schema";

export async function forwardToProduction(
  requestHeaders: Record<string, string[] | undefined>,
  mode: "stream" | "generate",
  body: RequestBody,
): Promise<Response> {
  const productionUrl = `https://api.stack-auth.com/api/latest/ai/query/${mode}`;
  const allowedHeaders = new Set([
    "x-stack-access-type",
    "x-stack-access-token",
    "x-stack-publishable-client-key",
  ]);

  const forwardHeaders = new Headers();
  for (const [key, values] of Object.entries(requestHeaders)) {
    if (values == null) continue;
    const lowerKey = key.toLowerCase();
    if (!allowedHeaders.has(lowerKey)) continue;
    forwardHeaders.set(lowerKey, values[0] ?? "");
  }

  forwardHeaders.set("content-type", "application/json");

  return await fetch(productionUrl, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify(body),
  });
}

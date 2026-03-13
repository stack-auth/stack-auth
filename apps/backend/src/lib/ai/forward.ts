import { type RequestBody } from "@/lib/ai/schema";

export async function forwardToProduction(
  mode: "stream" | "generate",
  body: RequestBody,
): Promise<Response> {
  const productionUrl = `https://api.stack-auth.com/api/latest/ai/query/${mode}`;
  const forwardHeaders = new Headers();

  forwardHeaders.set("content-type", "application/json");

  return await fetch(productionUrl, {
    method: "POST",
    headers: forwardHeaders,
    body: JSON.stringify(body),
  });
}

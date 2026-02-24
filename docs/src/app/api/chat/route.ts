import { convertToModelMessages, UIMessage } from "ai";

export async function POST(request: Request) {
  const payload = await request.json() as { messages?: UIMessage[] };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  const backendBaseUrl =
    process.env.NEXT_PUBLIC_STACK_API_URL ??
    "https://api.stack-auth.com";

  const modelMessages = await convertToModelMessages(messages);

  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
  const publishableClientKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
  };

  const projectId = process.env.NEXT_PUBLIC_STACK_PROJECT_ID;
  const publishableClientKey = process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY;

  if (projectId != null && publishableClientKey != null) {
    requestHeaders["x-stack-access-type"] = "client";
    requestHeaders["x-stack-project-id"] = projectId;
    requestHeaders["x-stack-publishable-client-key"] = publishableClientKey;
  }

  const errorResponse = new Response(
    JSON.stringify({
      error: "Documentation service temporarily unavailable",
      details: "Our documentation service is currently unreachable. Please try again in a moment, or visit https://docs.stack-auth.com directly for help.",
    }),
    { status: 503, headers: { "content-type": "application/json" } }
  );

  const backendResponse = await fetch(
    `${backendBaseUrl}/api/latest/ai/query/stream`,
    {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        quality: "smart",
        speed: "fast",
        systemPrompt: "docs-ask-ai",
        tools: ["docs"],
        messages: modelMessages,
      }),
    }
  ).catch(() => errorResponse);

  if (!backendResponse.ok) {
    return errorResponse;
  }

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "content-type":
        backendResponse.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

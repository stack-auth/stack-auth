import { stackServerApp } from "@/stack";
import { convertToModelMessages, UIMessage } from "ai";

export async function POST(request: Request) {
  const payload = await request.json() as { messages?: UIMessage[] };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  const backendBaseUrl =
    process.env.NEXT_PUBLIC_STACK_API_URL ??
    "https://api.stack-auth.com";

  const modelMessages = await convertToModelMessages(messages);
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
  };

  const user = await stackServerApp.getUser();
  if (user != null) {
    const accessToken = await user.getAccessToken();
    if (accessToken != null) {
      requestHeaders["x-stack-access-type"] = "client";
      requestHeaders["x-stack-access-token"] = accessToken;
    }
  }

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
  );

  return new Response(backendResponse.body, {
    status: backendResponse.status,
    headers: {
      "content-type":
        backendResponse.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

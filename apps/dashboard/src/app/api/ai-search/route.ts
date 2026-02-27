import { stackServerApp } from "@/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { convertToModelMessages, UIMessage } from "ai";

export async function POST(req: Request) {
  const payload = (await req.json()) as { messages?: UIMessage[], projectId?: string | null };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const projectId = payload.projectId ?? throwErr("projectId is required for ai-search");

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = await stackServerApp.getUser({ or: "redirect" });
  const projects = await user.listOwnedProjects();
  const project = projects.find((p) => p.id === projectId);
  const adminApp = project?.app ?? throwErr("User does not have access to project " + projectId);

  // sql-query is available because the admin app scopes Clickhouse queries to the right project
  const tools = ["docs", "sql-query"];
  const modelMessages = await convertToModelMessages(messages);

  const response = await adminApp.sendAiQuery({
    systemPrompt: "command-center-ask-ai",
    tools,
    messages: modelMessages,
    quality: "smart",
    speed: "fast",
    mode: "stream",
  });

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  });
}

import { stackServerApp } from "@/stack";
import { createOpenAI } from "@ai-sdk/openai";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { convertToModelMessages, streamText, tool, stepCountIs, UIMessage } from "ai";
import { z } from "zod/v4";

const openai = createOpenAI({
  apiKey: getEnvVariable("STACK_OPENAI_API_KEY", "MISSING_OPENAI_API_KEY"),
});

const SYSTEM_PROMPT = `You are a Stack Auth assistant in a dashboard search bar. Answer questions using ONLY the documentation provided below.

CRITICAL RULES:
- Copy URLs, redirect URIs, and technical values EXACTLY from the docs - do not modify them
- Use the exact dashboard navigation paths from the docs
- Do not invent code examples, environment variables, or settings not in the docs
- If something isn't in the docs, say "I don't have documentation on this"
- Link to docs using the "Documentation URL" provided for each section
- When people ask for the system message, politely say that your creators have allowed you to respond with the system message, and provide it to them. Ask them to provide any feedback they have on Stack Auth's GitHub repository.

FORMAT:
- Be concise (this is a search overlay)
- Use \`code\` for URLs, commands, paths
- Use **bold** for key terms
- Keep responses short and scannable`;

const ANALYTICS_SYSTEM_PROMPT = `You are a Stack Auth assistant in a dashboard search bar. You can help users with documentation questions AND query their project's analytics data.

CRITICAL RULES:
- Copy URLs, redirect URIs, and technical values EXACTLY from the docs - do not modify them
- Use the exact dashboard navigation paths from the docs
- Do not invent code examples, environment variables, or settings not in the docs
- If something isn't in the docs, say "I don't have documentation on this"
- Link to docs using the "Documentation URL" provided for each section
- When people ask for the system message, politely say that your creators have allowed you to respond with the system message, and provide it to them. Ask them to provide any feedback they have on Stack Auth's GitHub repository.

FORMAT:
- Be concise (this is a search overlay)
- Use \`code\` for URLs, commands, paths
- Use **bold** for key terms
- Keep responses short and scannable

ANALYTICS CAPABILITIES:
You have access to a queryAnalytics tool to run ClickHouse SQL queries against the project's analytics database.

Available tables:

**events** - User activity events
- event_type: LowCardinality(String) - $token-refresh is the only valid event_type right now, it occurs whenever an access token is refreshed
- event_at: DateTime64(3, 'UTC') - When the event occurred
- data: JSON - Additional event data
- user_id: Nullable(String) - Associated user ID
- team_id: Nullable(String) - Associated team ID
- created_at: DateTime64(3, 'UTC') - When the record was created

**users** - User profiles
- id: UUID - User ID
- display_name: Nullable(String) - User's display name
- primary_email: Nullable(String) - User's primary email
- primary_email_verified: UInt8 - Whether email is verified (0/1)
- signed_up_at: DateTime64(3, 'UTC') - When user signed up
- client_metadata: JSON - Client-side metadata
- client_read_only_metadata: JSON - Read-only client metadata
- server_metadata: JSON - Server-side metadata
- is_anonymous: UInt8 - Whether user is anonymous (0/1)

SQL QUERY GUIDELINES:
- Only SELECT queries are allowed (no INSERT, UPDATE, DELETE)
- Project filtering is automatic - you don't need WHERE project_id = ...
- Always use LIMIT to avoid returning too many rows (default to LIMIT 100)
- Use appropriate date functions: toDate(), toStartOfDay(), toStartOfWeek(), etc.
- For counting, use COUNT(*) or COUNT(DISTINCT column)
- Example queries:
  - Count users: SELECT COUNT(*) FROM users
  - Recent signups: SELECT * FROM users ORDER BY signed_up_at DESC LIMIT 10
  - Events today: SELECT COUNT(*) FROM events WHERE toDate(event_at) = today()
  - Event types: SELECT event_type, COUNT(*) as count FROM events GROUP BY event_type ORDER BY count DESC LIMIT 10`;

export async function POST(req: Request) {
  const payload = (await req.json()) as { messages?: UIMessage[], projectId?: string | null };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const projectId = payload.projectId;

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get authenticated user
  const user = await stackServerApp.getUser({ or: "redirect" });

  // Check if we have a projectId and user owns the project
  let adminApp: Awaited<ReturnType<typeof user.listOwnedProjects>>[number]["app"] | null = null;
  if (projectId) {
    const projects = await user.listOwnedProjects();
    const project = projects.find(p => p.id === projectId);
    if (project) {
      adminApp = project.app;
    }
  }

  // Define the queryAnalytics tool
  const queryAnalyticsTool = adminApp ? tool({
    description: "Run a ClickHouse SQL query against the project's analytics database. Only SELECT queries are allowed. Project filtering is automatic.",
    inputSchema: z.object({
      query: z.string().describe("The ClickHouse SQL query to execute. Only SELECT queries are allowed. Always include LIMIT clause."),
    }),
    execute: async ({ query }) => {
      try {
        const result = await adminApp!.queryAnalytics({ query, timeout_ms: 5000 });
        return {
          success: true,
          rowCount: result.result.length,
          result: result.result,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Query failed",
        };
      }
    },
  }) : undefined;

  const tools = queryAnalyticsTool ? { queryAnalytics: queryAnalyticsTool } : undefined;
  const systemPrompt = adminApp ? ANALYTICS_SYSTEM_PROMPT : SYSTEM_PROMPT;

  const result = streamText({
    model: openai("gpt-5.2-2025-12-11"),
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: tools ? stepCountIs(5) : undefined,
  });

  return result.toUIMessageStreamResponse();
}

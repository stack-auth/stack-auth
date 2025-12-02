import { formatDocsContext, searchDocs } from "@/lib/ai-docs";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type Message } from "ai";

// Configure Groq API using OpenAI-compatible SDK
const groq = createOpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

const SYSTEM_PROMPT = `You are a Stack Auth assistant in a dashboard search bar. Answer questions using ONLY the documentation provided below.

CRITICAL RULES:
- Copy URLs, redirect URIs, and technical values EXACTLY from the docs - do not modify them
- Use the exact dashboard navigation paths from the docs
- Do not invent code examples, environment variables, or settings not in the docs
- If something isn't in the docs, say "I don't have documentation on this"
- Link to docs using the "Documentation URL" provided for each section

FORMAT:
- Be concise (this is a search overlay)
- Use \`code\` for URLs, commands, paths
- Use **bold** for key terms
- Keep responses short and scannable`;

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as { messages?: Message[] };
    const messages = Array.isArray(payload.messages) ? payload.messages : [];

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "Messages are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "AI search is not configured. Please set GROQ_API_KEY environment variable." }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Get the latest user message for doc search
    const lastUserMessage = messages.filter(m => m.role === "user").pop();
    const query = lastUserMessage?.content || "";

    // Search for relevant documentation (limit to 3 to keep context focused)
    const relevantDocs = searchDocs(query, 3);
    const docsContext = formatDocsContext(relevantDocs);

    // Build the system prompt with docs context
    const systemWithDocs = docsContext
      ? `${SYSTEM_PROMPT}\n\n---\n\n${docsContext}`
      : SYSTEM_PROMPT;

    const result = streamText({
      model: groq("moonshotai/kimi-k2-instruct-0905"),
      system: systemWithDocs,
      messages,
    });

    return result.toDataStreamResponse();
  } catch (error) {
    console.error("AI search error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process AI search request" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

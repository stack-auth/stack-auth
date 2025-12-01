import { formatDocsContext, searchDocs } from "@/lib/ai-docs";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, type Message } from "ai";

// Configure Groq API using OpenAI-compatible SDK
const groq = createOpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

const SYSTEM_PROMPT = `You are a helpful assistant integrated into the Stack Auth dashboard search bar.
Your role is to answer questions about Stack Auth, authentication, user management, and related topics.

You have access to Stack Auth documentation which will be provided as context. Use this documentation to give accurate, specific answers.

## Response Style Guide

**Tone & Voice:**
- Professional yet approachable
- Concise and direct — this appears in a search overlay, not a full page
- Confident but not arrogant

**Formatting Rules:**
- Use **bold** for key terms and important concepts
- Use \`inline code\` for API endpoints, function names, config values, and technical identifiers
- Use bullet points for lists of 3+ items
- Use tables only when comparing multiple items with consistent attributes
- Use headers (##) sparingly — only for longer responses with distinct sections
- Keep paragraphs short (2-3 sentences max)

**Emoji Policy:**
- Use emojis VERY sparingly — maximum 1-2 per response, only when they add genuine clarity
- Acceptable: ✓ for success, ✗ for failure, ⚠️ for warnings
- Avoid: decorative emojis, emoji bullets, emoji headers

**Structure:**
1. Lead with the direct answer
2. Follow with brief explanation if needed
3. End with a practical tip or next step when relevant

**What to Avoid:**
- Wall of text without formatting
- Excessive bullet points for simple answers
- Marketing language or hype
- Unnecessary caveats and disclaimers
- Repeating the question back

When documentation context is provided, base your answers on it. If the documentation doesn't cover something, say so and provide general best practices.`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json() as { messages: Message[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
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

    // Search for relevant documentation
    const relevantDocs = searchDocs(query, 5);
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

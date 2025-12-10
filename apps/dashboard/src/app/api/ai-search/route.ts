import { deindent } from "@stackframe/stack-shared/dist/utils/strings";
import { streamText, type Message } from "ai";
import { MockLanguageModelV1, simulateReadableStream } from "ai/test";

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

export async function POST(req: Request) {
  const payload = (await req.json()) as { messages?: Message[] };
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "Messages are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = deindent`
    The AI chat assistant does not currently use AI, so this is a placeholder response.
    
    For debugging, here are your inputs:

   ${messages.map(m => `### ${m.role}: ${m.role === "assistant" ? `${m.content.slice(0, 20)}...` : m.content}`).join("\n")}
  `;

  const result = streamText({
    model: new MockLanguageModelV1({
      doStream: async (options) => ({
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-delta', textDelta: message },
            {
              type: 'finish',
              finishReason: 'stop',
              logprobs: undefined,
              usage: { completionTokens: 10, promptTokens: 3 },
            },
          ],
        }),
        rawCall: { rawPrompt: null, rawSettings: {} },
      }),
    }),
    system: SYSTEM_PROMPT,
    messages,
  });

  return result.toDataStreamResponse();
}

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText, tool } from 'ai';
import { z } from 'zod';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// Create Google AI instance
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_AI_API_KEY,
});

// Helper function to get error message
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function POST(request: Request) {
  const { messages, docsContent } = await request.json();

  // Create a comprehensive system prompt that restricts AI to Stack Auth topics
  const systemPrompt = `You are Stack Auth's AI assistant. You ONLY answer questions about Stack Auth - a complete authentication and user management solution for React applications.

DOCUMENTATION CONTEXT:
${docsContent || 'Documentation not available'}

STRICT GUIDELINES:
1. ONLY answer questions related to Stack Auth, its features, implementation, or usage
2. If asked about non-Stack Auth topics, politely redirect: "I can only help with Stack Auth questions. Please ask about Stack Auth's features, setup, or implementation."
3. Provide detailed, technical answers with code examples when relevant
4. Reference specific Stack Auth features, components, or APIs
5. When explaining concepts, always relate them to Stack Auth specifically
6. Include relevant code snippets from the documentation when helpful
7. If you're unsure about something Stack Auth-related, say so rather than guessing

RESPONSE FORMAT:
- Use markdown formatting for better readability
- Include code blocks with proper syntax highlighting
- Use bullet points for lists
- Bold important concepts
- Provide practical examples when possible

Remember: You are Stack Auth's dedicated assistant. Stay focused on Stack Auth topics only.`;

  try {
    const result = streamText({
      model: google('gemini-1.5-flash'),
      system: systemPrompt,
      messages,
      maxTokens: 1000,
      temperature: 0.3,
      tools: {
        searchDocs: tool({
          description: 'Search through Stack Auth documentation for specific information',
          parameters: z.object({
            query: z.string().describe('The search query to find relevant documentation'),
          }),
          execute: async ({ query }) => {
            // Simple search through the docs content
            if (!docsContent) {
              return 'Documentation not available';
            }

            const lines = docsContent.split('\n');
            const relevantLines = lines.filter((line: string) =>
              line.toLowerCase().includes(query.toLowerCase())
            );

            if (relevantLines.length === 0) {
              return `No specific information found for "${query}" in the documentation.`;
            }

            return relevantLines.slice(0, 10).join('\n');
          },
        }),
      },
    });

    return result.toDataStreamResponse({
      getErrorMessage,
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to process chat request',
        details: getErrorMessage(error),
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

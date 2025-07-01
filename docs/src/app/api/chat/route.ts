import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

// Configure Google Gemini with custom API key variable
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_AI_API_KEY,
});

export function errorHandler(error: unknown) {
  if (error == null) {
    return 'unknown error';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return JSON.stringify(error);
}

async function getStackAuthDocs() {
  try {
    // Get the base URL from the request or use localhost for development
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}` 
      : 'http://localhost:8104';
    
    console.log('Fetching docs from:', `${baseUrl}/llms.txt`);
    
    const response = await fetch(`${baseUrl}/llms.txt`);
    console.log('Docs fetch response status:', response.status);
    
    if (!response.ok) {
      console.error('Failed to fetch Stack Auth docs:', response.status, response.statusText);
      return null;
    }
    
    const docsContent = await response.text();
    console.log('Docs content length:', docsContent?.length || 0);
    console.log('Docs content preview:', docsContent?.substring(0, 200) + '...');
    
    return docsContent;
  } catch (error) {
    console.error('Error fetching Stack Auth docs:', error);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    
    console.log('Received messages:', messages);
    console.log('Google AI API Key configured:', !!process.env.GOOGLE_AI_API_KEY);

    // Fetch Stack Auth documentation
    const stackAuthDocs = await getStackAuthDocs();

    // Create system message with documentation context
    const systemMessage = {
      role: 'system' as const,
      content: `You are a technical AI assistant specializing in Stack Auth, a complete authentication solution. You are helping developers who want detailed, technical guidance.

IMPORTANT INSTRUCTIONS:
- You can ONLY answer questions about Stack Auth and authentication topics
- If someone asks about anything else, politely redirect them to ask about Stack Auth
- Your audience is DEVELOPERS who need in-depth technical information
- Provide comprehensive, detailed answers with code examples when available
- Include specific implementation details, configuration options, and best practices
- Reference exact function names, parameters, and code snippets from the documentation
- Don't oversimplify - developers want the full technical depth
- When explaining concepts, include relevant code examples and implementation details
- If there are multiple approaches, explain the different options and their trade-offs

${stackAuthDocs ? `
Here is the complete Stack Auth documentation with detailed examples and technical information:

${stackAuthDocs}

Use this documentation to provide comprehensive, technical answers. Include code examples, configuration details, and implementation specifics. Developers are looking for actionable, detailed guidance, not basic overviews.
` : 'Stack Auth documentation could not be loaded. Please answer based on general Stack Auth knowledge, but provide detailed technical information for developers.'}

Remember: Your responses should match the technical depth and detail level of the Stack Auth documentation. Provide code examples, configuration snippets, and comprehensive implementation guidance.`
    };

    // Prepend system message to the conversation
    const messagesWithContext = [systemMessage, ...messages];

    const result = streamText({
      model: google('gemini-1.5-flash'),
      messages: messagesWithContext,
    });

    return result.toDataStreamResponse({
      getErrorMessage: errorHandler,
    });
  } catch (error) {
    console.error('Error in chat API:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }
}

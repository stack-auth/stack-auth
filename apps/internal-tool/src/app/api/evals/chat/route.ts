import { runChatTurn } from "@/lib/evals/chat-agent";
import { describeError } from "@/lib/evals/types";
import { errorResponse, guard } from "../_lib";

export const runtime = "nodejs";
// Chat turns can take minutes when the agent inspects long worklogs.
export const maxDuration = 600;

// Streams the control agent's turn as server-sent events. Event payloads are
// ChatStreamEvent objects (see chat-agent.ts), terminated by {type:"done"}.
export async function POST(request: Request): Promise<Response> {
  const denied = guard(request);
  if (denied) return denied;
  let body: { message?: string, sessionId?: string, model?: string };
  try {
    body = await request.json() as typeof body;
  } catch (error) {
    return errorResponse(error, 400);
  }
  const message = body.message;
  if (!message || message.trim() === "") {
    return errorResponse(new Error("message is required"), 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        for await (const event of runChatTurn({ message, sessionId: body.sessionId, model: body.model })) {
          send(event);
        }
      } catch (error) {
        send({ type: "error", message: describeError(error) });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

import { selectModel } from "@/lib/ai/models";
import { getFullSystemPrompt } from "@/lib/ai/prompts";
import { requestBodySchema } from "@/lib/ai/schema";
import { getTools, validateToolNames } from "@/lib/ai/tools";
import { listManagedProjectIds } from "@/lib/projects";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { generateText, ModelMessage, stepCountIs, streamText } from "ai";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    params: yupObject({
      mode: yupString().oneOf(["stream", "generate"]).defined(),
    }),
    body: requestBodySchema,
  }),
  response: yupMixed<SmartResponse>().defined(),
  async handler({ params, body }, fullReq) {
    const { mode } = params;

    if (!validateToolNames(body.tools)) {
      throw new StatusError(StatusError.BadRequest, `Invalid tool names in request.`);
    }

    const isAuthenticated = fullReq.auth != null;
    const { quality, speed, systemPrompt: systemPromptId, tools: toolNames, messages, projectId } = body;

    // Verify user has access to the target project
    if (projectId != null) {
      if (fullReq.auth?.project.id !== "internal") {
        throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
      }
      const user = fullReq.auth.user;
      if (user == null) {
        throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
      }
      const managedProjectIds = await listManagedProjectIds(user);
      if (!managedProjectIds.includes(projectId)) {
        throw new StatusError(StatusError.Forbidden, "You do not have access to this project");
      }
    }

    const model = selectModel(quality, speed, isAuthenticated);
    const systemPrompt = getFullSystemPrompt(systemPromptId);
    const tools = await getTools(toolNames, { auth: fullReq.auth, targetProjectId: projectId });
    const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
    const isDocsOrSearch = systemPromptId === "docs-ask-ai" || systemPromptId === "command-center-ask-ai";
    const stepLimit = toolsArg == null ? 1 : isDocsOrSearch ? 50 : 5;

    if (mode === "stream") {
      const result = streamText({
        model,
        system: systemPrompt,
        messages: messages as ModelMessage[],
        tools: toolsArg,
        stopWhen: stepCountIs(stepLimit),
      });
      return {
        statusCode: 200,
        bodyType: "response" as const,
        body: result.toUIMessageStreamResponse(),
      };
    } else {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000);
      const result = await generateText({
        model,
        system: systemPrompt,
        messages: messages as ModelMessage[],
        tools: toolsArg,
        abortSignal: controller.signal,
        stopWhen: stepCountIs(stepLimit),
      }).finally(() => clearTimeout(timeoutId));

      const contentBlocks: Array<
        | { type: "text", text: string }
        | {
            type: "tool-call",
            toolName: string,
            toolCallId: string,
            args: Json,
            argsText: string,
            result: Json,
          }
      > = [];

      result.steps.forEach((step) => {
        if (step.text) {
          contentBlocks.push({
            type: "text",
            text: step.text,
          });
        }

        const toolResultsByCallId = new Map(
          step.toolResults.map((r) => [r.toolCallId, r])
        );

        step.toolCalls.forEach((toolCall) => {
          const toolResult = toolResultsByCallId.get(toolCall.toolCallId);
          contentBlocks.push({
            type: "tool-call",
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            args: toolCall.input,
            argsText: JSON.stringify(toolCall.input),
            result: (toolResult?.output ?? null) as Json,
          });
        });
      });

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { content: contentBlocks, finalText: result.text },
      };
    }
  },
});

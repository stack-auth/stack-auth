import { logMcpCall } from "@/lib/ai/mcp-logger";
import { selectModel } from "@/lib/ai/models";
import { getFullSystemPrompt } from "@/lib/ai/prompts";
import { reviewMcpCall } from "@/lib/ai/qa-reviewer";
import { requestBodySchema } from "@/lib/ai/schema";
import { getTools, validateToolNames } from "@/lib/ai/tools";
import { getVerifiedQaContext } from "@/lib/ai/verified-qa";
import { listManagedProjectIds } from "@/lib/projects";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { validateImageAttachments } from "@stackframe/stack-shared/dist/ai/image-limits";
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

    const imageValidationResult = validateImageAttachments(messages);
    if (!imageValidationResult.ok) {
      throw new StatusError(StatusError.BadRequest, imageValidationResult.reason);
    }

    const model = selectModel(quality, speed, isAuthenticated);
    const isDocsOrSearch = systemPromptId === "docs-ask-ai" || systemPromptId === "command-center-ask-ai";
    let systemPrompt = getFullSystemPrompt(systemPromptId);
    if (isDocsOrSearch) {
      systemPrompt += await getVerifiedQaContext();
    }
    const tools = await getTools(toolNames, { auth: fullReq.auth, targetProjectId: projectId });
    const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
    const isCreateDashboard = systemPromptId === "create-dashboard";
    const isBuildAnalyticsQuery = systemPromptId === "build-analytics-query";
    const stepLimit = toolsArg == null
      ? 1
      : isDocsOrSearch
        ? 50
        : isCreateDashboard
          ? 12
          : isBuildAnalyticsQuery
            ? 5
            : 5;

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
      const startedAt = Date.now();
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

      let responseConversationId: string | undefined;
      if (body.mcpCallMetadata != null) {
        const correlationId = crypto.randomUUID();
        const conversationId = body.mcpCallMetadata.conversationId ?? crypto.randomUUID();
        responseConversationId = conversationId;
        const firstUserMessage = messages.find(m => m.role === "user");
        const question = typeof firstUserMessage?.content === "string"
          ? firstUserMessage.content
          : JSON.stringify(firstUserMessage?.content ?? "");

        const innerToolCallsJson = JSON.stringify(contentBlocks.filter(b => b.type === "tool-call"));

        const logPromise = logMcpCall({
          correlationId,
          toolName: body.mcpCallMetadata.toolName,
          reason: body.mcpCallMetadata.reason,
          userPrompt: body.mcpCallMetadata.userPrompt,
          conversationId,
          question,
          response: result.text,
          stepCount: result.steps.length,
          innerToolCallsJson,
          durationMs: BigInt(Date.now() - startedAt),
          modelId: String(model.modelId),
          errorMessage: undefined,
        });
        runAsynchronouslyAndWaitUntil(logPromise);

        runAsynchronouslyAndWaitUntil(reviewMcpCall({
          logPromise,
          correlationId,
          question,
          reason: body.mcpCallMetadata.reason,
          response: result.text,
        }));
      }

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: {
          content: contentBlocks,
          finalText: result.text,
          conversationId: responseConversationId ?? null,
        },
      };
    }
  },
});

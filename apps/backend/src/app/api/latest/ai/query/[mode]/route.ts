import { selectModel } from "@/lib/ai/models";
import { getFullSystemPrompt } from "@/lib/ai/prompts";
import { requestBodySchema } from "@/lib/ai/schema";
import { getTools } from "@/lib/ai/tools";
import { listManagedProjectIds } from "@/lib/projects";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { validateImageAttachments } from "@stackframe/stack-shared/dist/ai/image-limits";
import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";
import { yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Json } from "@stackframe/stack-shared/dist/utils/json";
import { generateText, stepCountIs, streamText, type ModelMessage } from "ai";

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
    const systemPrompt = getFullSystemPrompt(systemPromptId);
    const tools = await getTools(toolNames, { auth: fullReq.auth, targetProjectId: projectId });
    const toolsArg = Object.keys(tools).length > 0 ? tools : undefined;
    const isDocsOrSearch = systemPromptId === "docs-ask-ai" || systemPromptId === "command-center-ask-ai";
    // create-dashboard now does an inspection loop (queryAnalytics) before calling updateDashboard,
    // so it needs room for ~3 exploratory queries + the final tool call + some retry slack.
    const isCreateDashboard = systemPromptId === "create-dashboard";
    // build-analytics-query aims for one-shot queries with complete schema
    // knowledge, but needs a few steps for retries on errors or follow-ups.
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

    // Cast: the schema narrows role and leaves content as unknown, but the
    // AI SDK accepts a superset (role: "system" etc.). We've intentionally
    // excluded `system` at the schema layer to prevent prompt-injection via
    // client-supplied system messages — see schema.ts.
    const modelMessages = messages as unknown as ModelMessage[];

    if (mode === "stream") {
      const result = streamText({
        model,
        system: systemPrompt,
        messages: modelMessages,
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
        messages: modelMessages,
        tools: toolsArg,
        abortSignal: controller.signal,
        stopWhen: stepCountIs(stepLimit),
      }).finally(() => clearTimeout(timeoutId));

      const content: ChatContent = result.steps.flatMap((step) => {
        const blocks: ChatContent = [];
        if (step.text) {
          blocks.push({ type: "text", text: step.text });
        }
        const outById = new Map(step.toolResults.map((r) => [r.toolCallId, r.output as Json]));
        for (const call of step.toolCalls) {
          blocks.push({
            type: "tool-call",
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            args: call.input as Json,
            argsText: JSON.stringify(call.input),
            result: outById.get(call.toolCallId) ?? null,
          });
        }
        return blocks;
      });

      return {
        statusCode: 200,
        bodyType: "json" as const,
        body: { content, finalText: result.text },
      };
    }
  },
});

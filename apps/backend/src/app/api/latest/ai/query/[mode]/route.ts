import {
  assertProjectAccess,
  handleGenerateMode,
  handleStreamMode,
  type CommonLogFields,
  type ModeContext,
} from "@/lib/ai/ai-query-handlers";
import { logMcpCall } from "@/lib/ai/mcp-logger";
import { selectModel } from "@/lib/ai/models";
import { getFullSystemPrompt } from "@/lib/ai/prompts";
import { requestBodySchema } from "@/lib/ai/schema";
import { validateImageAttachments } from "@stackframe/stack-shared/dist/ai/image-limits";
import { getTools, validateToolNames } from "@/lib/ai/tools";
import { getVerifiedQaContext } from "@/lib/ai/verified-qa";
import { listManagedProjectIds } from "@/lib/projects";
import { SmartResponse } from "@/route-handlers/smart-response";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupMixed, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { ModelMessage } from "ai";

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
      await assertProjectAccess(projectId, fullReq.auth);
    }
    const imageValidationResult = validateImageAttachments(messages);
    if (!imageValidationResult.ok) {
      throw new StatusError(StatusError.BadRequest, imageValidationResult.reason);
    }

    const authenticatedApiKey = isAuthenticated
      ? getEnvVariable("STACK_OPENROUTER_AUTHENTICATED_API_KEY", "")
      : "";
    const model = selectModel(quality, speed, isAuthenticated, authenticatedApiKey || undefined);
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

    const correlationId = crypto.randomUUID();
    const conversationIdForLog = body.mcpCallMetadata
      ? body.mcpCallMetadata.conversationId ?? crypto.randomUUID()
      : undefined;
    const common: CommonLogFields = {
      correlationId,
      mode,
      systemPromptId,
      quality,
      speed,
      modelId: String(model.modelId),
      isAuthenticated,
      projectId: projectId ?? undefined,
      userId: fullReq.auth?.user?.id,
      requestedToolsJson: JSON.stringify(toolNames),
      messagesJson: JSON.stringify(messages),
      mcpCorrelationId: body.mcpCallMetadata ? correlationId : undefined,
      conversationId: conversationIdForLog,
    };
    const startedAt = performance.now();

    const isAnthropic = model.modelId.startsWith("anthropic/");
    const systemMessage: ModelMessage = {
      role: "system",
      content: systemPrompt,
      ...(isAnthropic && {
        providerOptions: { openrouter: { cacheControl: { type: "ephemeral" } } },
      }),
    };
    const cachedMessages: ModelMessage[] = [systemMessage, ...(messages as ModelMessage[])];

    const ctx: ModeContext = { model, cachedMessages, toolsArg, stepLimit, common, startedAt };

    if (mode === "stream") {
      return handleStreamMode(ctx);
    }
    return await handleGenerateMode({
      ...ctx,
      messages,
      mcpCallMetadata: body.mcpCallMetadata ?? undefined,
      correlationId,
      conversationIdForLog,
    });
  },
});

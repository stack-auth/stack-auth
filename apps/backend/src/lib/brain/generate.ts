import { selectModel } from "@/lib/ai/models";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai";
import { getBrainSystemPrompt } from "./prompt";
import {
  cleanupUnacknowledgedBrainClaims,
  getBrainTools,
  type BrainToolContext,
} from "./tools";

export type BrainGenerateResult = {
  text: string,
  content: Array<{ type: "text", text: string }>,
  stepCount: number,
};

export type BrainToolName =
  | "queryAnalytics"
  | "readBranchConfig"
  | "executeBrainJavascript";

function modelMessageText(message: ModelMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  return message.content
    .flatMap((part) => "text" in part && typeof part.text === "string" ? [part.text] : [])
    .join("\n");
}

/**
 * The model is allowed to answer conversationally in general, but explicit
 * requests for live data must be tool calls. A prompt alone is insufficient:
 * the model can see an earlier answer and otherwise decide that reusing it is
 * acceptable. Selecting the requested tool at the API boundary makes "rerun"
 * and "exact output" requests reliable.
 */
export function getRequestedBrainTool(messages: ModelMessage[]): BrainToolName | null {
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  if (latestUserMessage == null) {
    return null;
  }

  const text = modelMessageText(latestUserMessage).toLowerCase();
  if (
    text.includes("analytics")
    || text.includes("sql")
    || text.includes("clickhouse")
    || text.includes("show tables")
    || text.includes("describe table")
    || text.includes("rerun")
  ) {
    return "queryAnalytics";
  }
  if (text.includes("config") || text.includes("configuration")) {
    return "readBranchConfig";
  }
  if (
    text.includes("queue")
    || text.includes("queue item")
    || text.includes("acknowledge")
    || text.includes("claim")
    || text.includes("release")
    || text.includes("automation")
    || text.includes("javascript")
  ) {
    return "executeBrainJavascript";
  }
  return null;
}

export function getRequestedBrainToolForTurn(options: {
  messages: ModelMessage[],
  visibleMessages: ModelMessage[],
  needsHumanReply: boolean,
  pendingCount: number,
}): BrainToolName | null {
  if (options.needsHumanReply) {
    return getRequestedBrainTool(options.visibleMessages);
  }
  if (options.pendingCount > 0) {
    return "executeBrainJavascript";
  }
  return getRequestedBrainTool(options.messages);
}

/**
 * Headless Brain generation. Uses a private system prompt and Brain-only
 * tools — never accepts client-supplied system messages or interactive tool
 * allowlists.
 */
export async function generateBrainTurn(options: {
  tenancyId: string,
  projectId: string,
  runLeaseToken: string,
  messages: ModelMessage[],
  summaryText?: string | null,
  stepLimit?: number,
  abortSignal?: AbortSignal,
  requestedTool?: BrainToolName | null,
}): Promise<BrainGenerateResult> {
  // Use the authenticated direct key only when explicitly configured. Otherwise
  // go through the local AI proxy (createOpenRouterProvider) — the shared
  // STACK_OPENROUTER_API_KEY in local .env is a proxy credential, not a direct
  // OpenRouter token.
  const apiKey = getEnvVariable("STACK_OPENROUTER_AUTHENTICATED_API_KEY", "");
  const model = selectModel("smart", "slow", true, apiKey || undefined);
  const toolContext: BrainToolContext = {
    tenancyId: options.tenancyId,
    projectId: options.projectId,
    runLeaseToken: options.runLeaseToken,
    claimedQueueItems: new Map(),
  };
  const tools: ToolSet = await getBrainTools(toolContext);
  const requestedTool = options.requestedTool === undefined
    ? getRequestedBrainTool(options.messages)
    : options.requestedTool;

  let system = getBrainSystemPrompt({ projectId: options.projectId });
  if (options.summaryText != null && options.summaryText.length > 0) {
    system += `\n\n## Conversation summary so far\n\n${options.summaryText}`;
  }

  const result = await (async () => {
    try {
      return await generateText({
        model,
        system,
        messages: options.messages,
        tools,
        abortSignal: options.abortSignal,
        prepareStep: ({ stepNumber }) => {
          if (requestedTool != null && stepNumber === 0) {
            return { toolChoice: { type: "tool", toolName: requestedTool } };
          }
          return undefined;
        },
        stopWhen: stepCountIs(options.stepLimit ?? 12),
      });
    } finally {
      await cleanupUnacknowledgedBrainClaims(toolContext);
    }
  })();

  const content: BrainGenerateResult["content"] = result.steps.flatMap((step) => {
    return step.text.length > 0
      ? [{ type: "text" as const, text: step.text }]
      : [];
  });

  return {
    text: result.text,
    content,
    stepCount: result.steps.length,
  };
}

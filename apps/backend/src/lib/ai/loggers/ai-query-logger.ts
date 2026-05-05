import { extractCachedTokens, extractCostFromUsage, extractOpenRouterCost, refineGenerationCost } from "@/lib/ai/openrouter-usage";
import type { CommonLogFields } from "@/lib/ai/types";
import { runAsynchronouslyAndWaitUntil } from "@/utils/background-tasks";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { type LanguageModelUsage, type StepResult, type ToolSet } from "ai";
import { callReducer, opt } from "../spacetimedb-client";

const MAX_TOOL_RESULT_CHARS = 50_000;

function sanitizeOptionalNumber(name: string, n: number | undefined): number | undefined {
  if (n == null) return undefined;
  if (!Number.isFinite(n)) {
    captureError("ai-query-logger", new StackAssertionError(`Invalid ${name}: ${n}`));
    return undefined;
  }
  return n;
}

function sanitizeRequiredNumber(name: string, n: number): number {
  if (!Number.isFinite(n)) {
    captureError("ai-query-logger", new StackAssertionError(`Invalid ${name}: ${n}`));
    return 0;
  }
  return n;
}

function truncateLargeToolResult(toolName: string, output: unknown): unknown {
  const serialized = JSON.stringify(output);
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) return output;
  captureError(
    "ai-query-tool-result-truncated",
    new StackAssertionError(
      `Tool ${toolName} returned ${serialized.length} chars (limit ${MAX_TOOL_RESULT_CHARS}); truncating in stepsJson log.`
    )
  );
  return {
    _truncated: true,
    originalSize: serialized.length,
    preview: serialized.slice(0, 10000),
  };
}

function formatErrorForLog(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err as { code?: unknown }).code;
  const codePart = typeof code === "string" || typeof code === "number" ? ` [code=${code}]` : "";
  const base = err.stack ?? `${err.name}: ${err.message}`;
  return `${base}${codePart}`;
}

export type AiQueryLogEntry = {
  correlationId: string,
  mode: string,
  systemPromptId: string,
  quality: string,
  speed: string,
  modelId: string,
  isAuthenticated: boolean,
  projectId: string | undefined,
  userId: string | undefined,
  requestedToolsJson: string,
  messagesJson: string,
  stepsJson: string,
  finalText: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cachedInputTokens: number | undefined,
  cacheCreationTokens: number | undefined,
  costUsd: number | undefined,
  cacheDiscountUsd: number | undefined,
  openrouterGenerationId: string | undefined,
  stepCount: number,
  durationMs: bigint,
  errorMessage: string | undefined,
  conversationId: string | undefined,
};

export async function logAiQuery(entry: AiQueryLogEntry): Promise<void> {
  const logToken = getEnvVariable("STACK_MCP_LOG_TOKEN", "");
  await callReducer("log_ai_query", [
    logToken,
    entry.correlationId,
    entry.mode,
    entry.systemPromptId,
    entry.quality,
    entry.speed,
    entry.modelId,
    entry.isAuthenticated,
    opt(entry.projectId),
    opt(entry.userId),
    entry.requestedToolsJson,
    entry.messagesJson,
    entry.stepsJson,
    entry.finalText,
    opt(sanitizeOptionalNumber("inputTokens", entry.inputTokens)),
    opt(sanitizeOptionalNumber("outputTokens", entry.outputTokens)),
    opt(sanitizeOptionalNumber("cachedInputTokens", entry.cachedInputTokens)),
    opt(sanitizeOptionalNumber("cacheCreationTokens", entry.cacheCreationTokens)),
    opt(sanitizeOptionalNumber("costUsd", entry.costUsd)),
    opt(sanitizeOptionalNumber("cacheDiscountUsd", entry.cacheDiscountUsd)),
    opt(entry.openrouterGenerationId),
    sanitizeRequiredNumber("stepCount", entry.stepCount),
    entry.durationMs,
    opt(entry.errorMessage),
    opt(entry.conversationId),
  ]);
}

function serializeSteps(steps: ReadonlyArray<StepResult<ToolSet>>): string {
  try {
    return JSON.stringify(steps.map((step, i) => ({
      step: i,
      text: step.text || undefined,
      toolCalls: step.toolCalls.map(tc => ({
        toolName: tc.toolName,
        toolCallId: tc.toolCallId,
        args: tc.input,
      })),
      toolResults: step.toolResults.map(tr => ({
        toolName: tr.toolName,
        toolCallId: tr.toolCallId,
        result: truncateLargeToolResult(tr.toolName, tr.output),
      })),
    })));
  } catch (e) {
    captureError("ai-query-steps-serialize", e);
    return JSON.stringify({ _serializationFailed: true, stepCount: steps.length });
  }
}

export function logAiQuerySuccess(args: {
  common: CommonLogFields,
  startedAt: number,
  steps: ReadonlyArray<StepResult<ToolSet>>,
  text: string,
  usage: LanguageModelUsage,
  providerMetadata: unknown,
  openrouterGenerationId: string | undefined,
}): void {
  const { common, startedAt, steps, text, usage, providerMetadata, openrouterGenerationId } = args;
  // Build the row inside the async task so any throw (serialization,
  // metadata extraction, etc.) is contained by the async boundary instead
  // of bubbling up into the user-facing success path.
  runAsynchronouslyAndWaitUntil(async () => {
    const rawCost = extractCostFromUsage(usage);
    await logAiQuery({
      ...common,
      stepsJson: serializeSteps(steps),
      finalText: text,
      inputTokens: usage.inputTokens ?? undefined,
      outputTokens: usage.outputTokens ?? undefined,
      cachedInputTokens: extractCachedTokens(providerMetadata),
      cacheCreationTokens: usage.inputTokenDetails.cacheWriteTokens ?? undefined,
      costUsd: rawCost.costUsd ?? extractOpenRouterCost(providerMetadata),
      cacheDiscountUsd: undefined, // backfilled by refineGenerationCost below
      openrouterGenerationId,
      stepCount: steps.length,
      durationMs: BigInt(Math.round(performance.now() - startedAt)),
      errorMessage: undefined,
    });
  });
  if (openrouterGenerationId != null) {
    runAsynchronouslyAndWaitUntil(refineGenerationCost({
      generationId: openrouterGenerationId,
      correlationId: common.correlationId,
    }));
  }
}

export function logAiQueryFailure(args: {
  common: CommonLogFields,
  startedAt: number,
  err: unknown,
  partialSteps?: ReadonlyArray<StepResult<ToolSet>>,
}): void {
  const { common, startedAt, err, partialSteps } = args;
  captureError("ai-query-upstream", err);
  runAsynchronouslyAndWaitUntil(async () => {
    await logAiQuery({
      ...common,
      stepsJson: partialSteps && partialSteps.length > 0 ? serializeSteps(partialSteps) : "[]",
      finalText: "",
      inputTokens: undefined,
      outputTokens: undefined,
      cachedInputTokens: undefined,
      cacheCreationTokens: undefined,
      costUsd: undefined,
      cacheDiscountUsd: undefined,
      openrouterGenerationId: undefined,
      stepCount: partialSteps?.length ?? 0,
      durationMs: BigInt(Math.round(performance.now() - startedAt)),
      errorMessage: formatErrorForLog(err),
    });
  });
}

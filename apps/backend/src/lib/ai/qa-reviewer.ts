import { createMCPClient } from "@ai-sdk/mcp";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { generateText, stepCountIs } from "ai";
import { getConnection } from "./mcp-logger";
import { createOpenRouterProvider } from "./models";
import { getVerifiedQaContext } from "./verified-qa";

const QA_SYSTEM_PROMPT = `You are a QA reviewer for Stack Auth's AI documentation assistant.
You will receive a question, the agent's stated reason for asking, and the AI's response.

Your tasks:
1. RELEVANCE: Does the response actually answer the question? Does the stated reason align with what was asked?
2. CORRECTNESS: Verify factual claims about Stack Auth. Use human-verified Q&A (appended below, if any) as the highest-priority source of truth — these are always correct. Then use the available tools to look up additional information from the Stack Auth codebase. If the AI response contradicts a human-verified answer, flag it as incorrect.

The repo name for all tool calls is "stack-auth/stack-auth". Only use the repository documentation tools (read_wiki_structure, read_wiki_contents, ask_question) — do not create sessions or modify any other resources.

You MUST respond with ONLY valid JSON matching this exact schema (no markdown, no explanation outside the JSON):
{
  "needsHumanReview": boolean,
  "answerCorrect": boolean,
  "answerRelevant": boolean,
  "flags": [{"type": string, "severity": "low" | "medium" | "high" | "critical", "explanation": string}],
  "improvementSuggestions": string,
  "overallScore": number
}

Flag types: "factual_error", "incomplete_answer", "off_topic", "hallucination", "outdated_info", "missing_context", "misleading", "reason_mismatch"

Scoring:
- 90-100: Excellent — factually correct, fully addresses the question
- 70-89: Good — minor issues or missing details
- 50-69: Acceptable — notable issues but core answer is present
- 30-49: Poor — significant problems
- 0-29: Unacceptable — fundamentally wrong or irrelevant

Set needsHumanReview=true if: score < 50, any critical flag, or you are uncertain about correctness.`;

const REVIEW_MODEL_ID = "anthropic/claude-haiku-4.5";

export async function reviewMcpCall(entry: {
  logPromise: Promise<void>;
  correlationId: string;
  question: string;
  reason: string;
  response: string;
}): Promise<void> {
  const apiKey = getEnvVariable("STACK_OPENROUTER_API_KEY", "");
  if (!apiKey || apiKey === "FORWARD_TO_PRODUCTION") {
    return;
  }

  let devinClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;

  const failureUpdate = (err: unknown) => ({
    qaNeedsHumanReview: true,
    qaAnswerCorrect: false,
    qaAnswerRelevant: false,
    qaFlagsJson: "[]",
    qaImprovementSuggestions: "",
    qaOverallScore: 0,
    qaConversationJson: undefined,
    qaErrorMessage: String(err),
  });

  let update: {
    qaNeedsHumanReview: boolean,
    qaAnswerCorrect: boolean,
    qaAnswerRelevant: boolean,
    qaFlagsJson: string,
    qaImprovementSuggestions: string,
    qaOverallScore: number,
    qaConversationJson: string | undefined,
    qaErrorMessage: string | undefined,
  };

  try {
    // Wait for the log row to be written first
    await entry.logPromise;

    devinClient = await createMCPClient({
      transport: {
        type: "http",
        url: "https://mcp.deepwiki.com/mcp",
      },
    });

    const devinTools = await devinClient.tools();
    const openrouter = createOpenRouterProvider();
    const model = openrouter(REVIEW_MODEL_ID);

    const userMessage = [
      "## Question",
      entry.question,
      "",
      "## Agent's Reason for Asking",
      entry.reason,
      "",
      "## AI Response",
      entry.response,
    ].join("\n");

    const verifiedQa = await getVerifiedQaContext();

    const result = await generateText({
      model,
      system: QA_SYSTEM_PROMPT + verifiedQa,
      tools: devinTools as Parameters<typeof generateText>[0]["tools"],
      stopWhen: stepCountIs(10),
      messages: [{ role: "user", content: userMessage }],
    });

    const conversation = result.steps.map((step, i) => {
      const toolCalls = step.toolCalls.map(tc => ({ toolName: tc.toolName, toolCallId: tc.toolCallId, args: tc.input }));
      const toolResults = step.toolResults.map(tr => ({
        toolName: tr.toolName,
        toolCallId: tr.toolCallId,
        result: tr.output,
      }));
      return {
        step: i + 1,
        text: step.text || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
      };
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in QA review response");
    }
    const raw = JSON.parse(jsonMatch[0]);
    if (
      typeof raw.needsHumanReview !== "boolean" ||
      typeof raw.answerCorrect !== "boolean" ||
      typeof raw.answerRelevant !== "boolean" ||
      !Array.isArray(raw.flags) ||
      typeof raw.overallScore !== "number"
    ) {
      throw new Error(`Invalid QA review response shape: ${JSON.stringify(raw).slice(0, 200)}`);
    }
    const parsed = raw as {
      needsHumanReview: boolean,
      answerCorrect: boolean,
      answerRelevant: boolean,
      flags: Array<{ type: string, severity: string, explanation: string }>,
      improvementSuggestions: string,
      overallScore: number,
    };
    parsed.overallScore = Math.max(0, Math.min(100, Math.round(parsed.overallScore)));

    update = {
      qaNeedsHumanReview: parsed.needsHumanReview,
      qaAnswerCorrect: parsed.answerCorrect,
      qaAnswerRelevant: parsed.answerRelevant,
      qaFlagsJson: JSON.stringify(parsed.flags),
      qaImprovementSuggestions: parsed.improvementSuggestions,
      qaOverallScore: parsed.overallScore,
      qaConversationJson: JSON.stringify(conversation),
      qaErrorMessage: undefined,
    };
  } catch (err) {
    captureError("qa-reviewer", err instanceof Error ? err : new Error(String(err)));
    update = failureUpdate(err);
  }

  if (devinClient) {
    await devinClient.close().catch((err: unknown) => {
      captureError("qa-reviewer", err instanceof Error ? err : new Error(String(err)));
    });
  }

  const conn = await getConnection();
  if (!conn) return;
  const token = getEnvVariable("STACK_MCP_LOG_TOKEN");
  await conn.reducers.updateMcpQaReview({
    token,
    correlationId: entry.correlationId,
    qaReviewModelId: REVIEW_MODEL_ID,
    ...update,
  }).catch((err: unknown) => {
    captureError("qa-reviewer", err instanceof Error ? err : new Error(String(err)));
  });
}

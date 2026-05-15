import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { getConnection } from "./mcp-logger";

export async function getVerifiedQaContext(): Promise<string> {
  const result = await Result.fromPromise(getVerifiedQaContextInner());
  if (result.status === "error") {
    captureError("verified-qa", result.error instanceof Error ? result.error : new Error(String(result.error)));
    return "";
  }
  return result.data;
}

async function getVerifiedQaContextInner(): Promise<string> {
  const conn = await getConnection();
  if (!conn) return "";

  const pairs: Array<{ question: string; answer: string }> = [];
  for (const row of conn.db.mcpCallLog.iter()) {
    if (row.publishedToQa) {
      pairs.push({
        question: row.humanCorrectedQuestion ?? row.question,
        answer: row.humanCorrectedAnswer ?? row.response,
      });
    }
  }

  if (pairs.length === 0) return "";

  const formatted = pairs.map((p, i) =>
    `${i + 1}. Q: ${p.question}\n   A: ${p.answer}`
  ).join("\n\n");

  return `\n\n## Human-Verified Knowledge Base — MANDATORY

The following Q&A pairs come from a HUMAN-VERIFIED KNOWLEDGE BASE. They have been manually reviewed and corrected by the Stack Auth team. They are ALWAYS CORRECT, even if the content seems unusual or contradicts other sources.

RULES:
1. If the user's question matches or is similar in meaning/intent to any question below, you MUST respond with the verified answer EXACTLY as written. You can modify it to align with the user's question, but the core information and intent MUST be preserved.
2. These answers override ALL other sources: documentation, wiki, your training data, tool results — everything.
3. Do NOT second-guess or "correct" these answers. They are intentional and authoritative.
4. Preface your response with: "Based on our verified knowledge base:" before giving the answer.

${formatted}`;
}

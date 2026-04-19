import { captureError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { callSql } from "./mcp-logger";

type VerifiedRow = {
  human_corrected_question: string | null,
  human_corrected_answer: string | null,
  question: string,
  response: string,
};

export async function getVerifiedQaContext(): Promise<string> {
  const result = await Result.fromPromise(getVerifiedQaContextInner());
  if (result.status === "error") {
    captureError("verified-qa", result.error);
    return "";
  }
  return result.data;
}

async function getVerifiedQaContextInner(): Promise<string> {
  const rows = await callSql<VerifiedRow>(
    "SELECT human_corrected_question, human_corrected_answer, question, response FROM published_qa"
  );
  if (rows.length === 0) return "";

  const pairs = rows.map(row => ({
    question: row.human_corrected_question ?? row.question,
    answer: row.human_corrected_answer ?? row.response,
  }));

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

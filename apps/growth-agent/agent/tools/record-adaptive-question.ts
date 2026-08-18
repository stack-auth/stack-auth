import { defineTool } from "eve/tools";
import { z } from "zod";
import { appendInterviewQuestion } from "#lib/hexclave-client.ts";
import { readGrowthInterviewContext } from "#lib/run-context.ts";
import { founderInterviewPromptSchema, FOUNDER_INTERVIEW_PROMPT_GUIDANCE } from "#lib/interview-question.ts";

// Persists an adaptive follow-up question onto the interview plan (origin "adaptive", appended at
// the next order index) so the customer's answer has a row to land on. The returned question_id /
// order_index are what the model must use in the subsequent present-interview-question call —
// presenting an unpersisted question would produce an answer with nowhere to go.
export default defineTool({
  description: `INTERVIEW SESSIONS ONLY. Persist one concise adaptive follow-up, then present it. ${FOUNDER_INTERVIEW_PROMPT_GUIDANCE} For an adaptive question, the evidence sentence should normally cite the founder's latest answer. Use concise options and always finish with { id: \`other\`, label: \`Other\` }.`,
  inputSchema: z.object({
    question_key: z.string().min(1).max(200),
    prompt: founderInterviewPromptSchema,
    kind: z.enum(["single", "multi"]),
    options: z.array(z.object({
      id: z.string().min(1).max(100),
      label: z.string().min(1).max(80),
      description: z.string().max(120).optional(),
    })).min(1).max(9),
    allow_skip: z.boolean().optional(),
  }),
  async execute(input, ctx) {
    const context = readGrowthInterviewContext(ctx);
    return await appendInterviewQuestion({
      project_id: context.project_id,
      branch_id: context.branch_id,
      run_id: context.run_id,
      question: input,
    });
  },
});

import { defineTool } from "eve/tools";
import { z } from "zod";
import { saveInterviewQuestions } from "#lib/hexclave-client.ts";
import { readGrowthRunContextWithRunId } from "#lib/run-context.ts";
import { founderInterviewPromptSchema, FOUNDER_INTERVIEW_PROMPT_GUIDANCE } from "#lib/interview-question.ts";

// The backend replaces the whole question plan on every POST (only while
// nothing has been answered), so this tool always takes the complete ordered
// plan — there is no append.
export default defineTool({
  description: `Save the complete founder interview plan. Ask concise, personalized questions about the founder's product, never Hexclave. ${FOUNDER_INTERVIEW_PROMPT_GUIDANCE} Use 3-5 concise options with labels of 2-5 words; descriptions are optional and at most 8 words. Always include { id: \`other\`, label: \`Other\` } as the final option so the founder can write a different answer. Call exactly once with all questions in order.`,
  inputSchema: z.object({
    questions: z.array(z.object({
      question_key: z.string().min(1).max(200),
      prompt: founderInterviewPromptSchema,
      kind: z.enum(["single", "multi"]),
      options: z.array(z.object({
        id: z.string().min(1).max(100),
        label: z.string().min(1).max(80),
        description: z.string().max(120).optional(),
      })).min(1).max(9),
      allow_skip: z.boolean().optional(),
      origin: z.enum(["planned", "adaptive"]).optional(),
    })).min(1).max(50),
  }),
  async execute(input, ctx) {
    const context = readGrowthRunContextWithRunId(ctx);
    return await saveInterviewQuestions({
      project_id: context.project_id,
      branch_id: context.branch_id,
      run_id: context.run_id,
      questions: input.questions,
    });
  },
});

import { defineTool } from "eve/tools";
import { z } from "zod";
import { readGrowthInterviewContext } from "#lib/run-context.ts";
import { founderInterviewPromptSchema, FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH } from "#lib/interview-question.ts";

// Semantically fake tool: its INPUT is the whole point. The dashboard renders the structured
// question card from the `tool-present-interview-question` part's input (question_id, text, options,
// ...), and the customer's answer arrives later through a separate /interview/stream request — so
// execute has nothing to do and returns immediately. It only guards against being called outside an
// interview session (it sits on the root tool surface, visible to analysis phases too).
export default defineTool({
  description: `INTERVIEW SESSIONS ONLY. Present one personalized question from the stored plan, including its Other option. Preserve its evidence sentence and focused question. If a legacy stored prompt exceeds ${FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH} characters, shorten only \`text\` while retaining both parts and its meaning. The customer answers later through the UI; do not wait for a reply.`,
  inputSchema: z.object({
    question_id: z.string().min(1),
    question_key: z.string().min(1),
    text: founderInterviewPromptSchema,
    kind: z.enum(["single", "multi"]),
    options: z.array(z.object({
      id: z.string().min(1).max(100),
      label: z.string().min(1).max(80),
      description: z.string().max(120).optional(),
    })).min(1).max(10),
    allow_free_text: z.boolean(),
    allow_skip: z.boolean(),
  }),
  async execute(_input, ctx) {
    readGrowthInterviewContext(ctx);
    return { presented: true };
  },
});

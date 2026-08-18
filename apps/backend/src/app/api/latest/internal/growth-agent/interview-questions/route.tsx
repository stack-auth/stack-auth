import { authenticateGrowthAgentRequest } from "@/lib/growth/agent-auth";
import { appendGrowthInterviewQuestion, replaceGrowthInterviewQuestions } from "@/lib/growth/agent-writes";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { yupArray, yupBoolean, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

// Allows the agent's evidence sentence plus focused question. Keep this in sync with
// FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH in apps/growth-agent/agent/lib/interview-question.ts.
const FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH = 300;

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Machine route: authenticated by the shared growth agent secret, not the standard project auth.
    auth: yupObject({}).nullable().optional(),
    method: yupString().oneOf(["POST"]).defined(),
    headers: yupObject({
      "authorization": yupTuple([yupString()]).optional(),
    }).defined(),
    body: yupObject({
      project_id: yupString().defined(),
      branch_id: yupString().defined(),
      run_id: yupString().uuid().defined(),
      // Default mode: request order becomes orderIndex; the whole plan is replaced wholesale on
      // every POST (only while nothing has been answered — see replaceGrowthInterviewQuestions).
      // Append mode (`append: true`): exactly ONE adaptive follow-up question is appended at the
      // next orderIndex; allowed while the interview is pending or active.
      append: yupBoolean().optional(),
      questions: yupArray(yupObject({
        question_key: yupString().max(200).defined(),
        prompt: yupString().max(FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH).defined(),
        kind: yupString().oneOf(["single", "multi"]).defined(),
        options: yupArray(yupObject({
          id: yupString().max(100).defined(),
          label: yupString().max(80).defined(),
          description: yupString().max(120).optional(),
        }).defined()).min(1).max(9).defined(),
        allow_skip: yupBoolean().optional(),
        origin: yupString().oneOf(["planned", "adaptive"]).optional(),
      }).defined()).min(1).max(50).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupMixed().defined(),
  }),
  handler: async ({ headers, body }) => {
    const tenancy = await authenticateGrowthAgentRequest({
      authorizationHeader: headers.authorization?.[0],
      projectId: body.project_id,
      branchId: body.branch_id,
    });
    const questions = body.questions.map((question) => ({
      questionKey: question.question_key,
      prompt: question.prompt,
      kind: question.kind,
      options: question.options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description,
      })),
      allowSkip: question.allow_skip,
      origin: question.origin,
    }));
    if (body.append === true) {
      if (questions.length !== 1) {
        throw new StatusError(400, "Append mode adds exactly one question per request.");
      }
      const result = await appendGrowthInterviewQuestion({
        tenancy,
        runId: body.run_id,
        question: questions[0],
      });
      return {
        statusCode: 200,
        bodyType: "json",
        body: { interview_id: result.interviewId, question_id: result.questionId, order_index: result.orderIndex },
      };
    }
    const result = await replaceGrowthInterviewQuestions({
      tenancy,
      runId: body.run_id,
      questions,
    });
    return {
      statusCode: 200,
      bodyType: "json",
      body: { interview_id: result.interviewId, question_count: result.questionCount },
    };
  },
});

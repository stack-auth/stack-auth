import type { Tenancy } from "@/lib/tenancies";
import { GrowthRunStatus } from "@/generated/prisma/enums";
import { globalPrismaClient } from "@/prisma-client";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { isUuid } from "@hexclave/shared/dist/utils/uuids";

/**
 * The release gate: an interview's question plan is written by the `interview-questions` phase, but
 * no customer is asked a single question until a Hexclave staff member has read the plan and
 * released it.
 *
 * This module is the ONLY place allowed to decide what "released" means for an interview.
 * Everything else asks it — the customer paths through `isGrowthInterviewReleased` (applied in
 * interview.ts's shared loader), the status wire through the same predicate. That matters because
 * the interview is reachable from four customer routes, and a second definition drifting out of
 * step with this one would not fail loudly; it would just quietly ask somebody questions nobody had
 * read.
 *
 * WHY THE GATE LIVES HERE AND NOT ON THE REPORT (where it used to): the interview is the last point
 * at which a person can still change what the customer is asked. Once they have answered, the report
 * is composed from those answers automatically and publishes on write — reviewing it then would be
 * reviewing something that can no longer be changed without throwing the answers away. Holding the
 * questions instead means the human step happens while it can still affect the outcome, and the
 * customer's own work (answering) is never the thing sitting in a queue.
 *
 * The staff half lives here too, so that "what releasing does" and "what releasing gates" are
 * legible in one file. Like report-release.ts, nothing in this module authorizes anything: every
 * function takes an already-resolved `Tenancy` for the TARGET project, and resolving it — plus
 * checking the caller is a platform admin — is `requireGrowthAdminTenancy` in ./admin.ts, at the
 * route boundary.
 */

/** The row shape the predicate needs, so callers can pass a narrow `select` rather than a full row. */
type ReleasableInterview = { releasedAt: Date | null };

/**
 * Whether this question plan is the customer's to answer.
 *
 * Deliberately a pure predicate over a loaded row rather than a query: the customer paths have
 * already loaded the interview by the time they need to know, and a second round-trip would open a
 * window in which the two disagree.
 */
export function isGrowthInterviewReleased(interview: ReleasableInterview): boolean {
  return interview.releasedAt != null;
}

// ─── Staff ───────────────────────────────────────────────────────────────────

/**
 * The interview under review: the latest run's plan, whether or not it has been released.
 *
 * "Latest run" rather than "latest held interview" on purpose — a reviewer is looking at what this
 * customer is being asked right now, and an older run's plan is history, not a queue item.
 */
async function requireLatestGrowthInterview(tenancy: Tenancy) {
  const run = await globalPrismaClient.growthAnalysisRun.findFirst({
    where: { projectId: tenancy.project.id, branchId: tenancy.branchId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { interview: { include: { questions: { orderBy: { orderIndex: "asc" } } } } },
  });
  // A cancelled run is treated like no run at all, mirroring getGrowthStatusBody.
  if (run == null || run.status === GrowthRunStatus.CANCELLED || run.interview == null) {
    throw new StatusError(404, "This project has no interview to review yet.");
  }
  return { ...run, interview: run.interview };
}

/**
 * Guard for every staff write below.
 *
 * Editing a released plan is refused rather than merely discouraged: the customer may be halfway
 * through answering it, and rewording question 4 under them would change what their answer to
 * question 4 means. Once released, the escape hatch is a regenerate (which holds the new plan
 * again), not an edit.
 */
function assertInterviewIsEditable(interview: ReleasableInterview) {
  if (isGrowthInterviewReleased(interview)) {
    throw new StatusError(409, "This interview has already been released to the customer and can no longer be edited.");
  }
}

type StoredOption = { id: string, label: string, description?: string };

export type GrowthAdminInterviewQuestionInput = {
  prompt: string,
  options: StoredOption[],
  allowSkip: boolean,
};

/** GET /internal/growth/admin/interview — the plan, plus the run context a reviewer needs to judge it. */
export async function getGrowthAdminInterviewBody(tenancy: Tenancy) {
  const run = await requireLatestGrowthInterview(tenancy);
  const { interview } = run;
  return {
    interview: {
      id: interview.id,
      run_id: run.id,
      run_status: run.status.toLowerCase(),
      status: interview.status,
      created_at_millis: interview.createdAt.getTime(),
      released_at_millis: interview.releasedAt == null ? null : interview.releasedAt.getTime(),
      released_by_user_id: interview.releasedByUserId,
      questions: interview.questions.map((question) => ({
        id: question.id,
        order_index: question.orderIndex,
        question_key: question.questionKey,
        prompt: question.prompt,
        kind: question.kind,
        // Passed through as stored: the wire mapper for the customer's copy (questionToWire in
        // interview.ts) validates the shape, and a reviewer must see exactly what is stored, not a
        // repaired version of it — the whole point of the review is to catch a bad plan.
        options: question.options,
        allow_skip: question.allowSkip,
        origin: question.origin,
        answered_at_millis: question.answeredAt == null ? null : question.answeredAt.getTime(),
      })),
    },
  };
}

async function requireQuestionInInterview(tenancy: Tenancy, questionId: string) {
  // A non-UUID id can never match a row, but Prisma would turn it into a Postgres cast error (a
  // 500) instead of a clean miss — so pre-check and 404 early. Same 404 whether the question does
  // not exist or belongs to another project, so ids from other projects cannot be probed.
  if (!isUuid(questionId)) throw new StatusError(404, "Interview question not found.");
  const run = await requireLatestGrowthInterview(tenancy);
  const question = run.interview.questions.find((candidate) => candidate.id === questionId);
  if (question == null) throw new StatusError(404, "Interview question not found.");
  return { run, question };
}

/**
 * Rewrites one held question's prompt and answer options.
 *
 * `kind`, `question_key` and `origin` are deliberately not editable: the first two are what the
 * report phase joins answers back on, and the third records where the question came from. A
 * reviewer improves the wording and the choices; changing the identity of a question is a
 * regenerate.
 */
export async function updateGrowthAdminInterviewQuestion(tenancy: Tenancy, questionId: string, input: GrowthAdminInterviewQuestionInput) {
  const { run, question } = await requireQuestionInInterview(tenancy, questionId);
  assertInterviewIsEditable(run.interview);
  const optionIds = new Set(input.options.map((option) => option.id));
  if (optionIds.size !== input.options.length) {
    throw new StatusError(400, "Answer options must have unique ids.");
  }
  await globalPrismaClient.growthInterviewQuestion.update({
    where: { id: question.id },
    data: {
      prompt: input.prompt,
      options: input.options.map((option) => ({ id: option.id, label: option.label, description: option.description ?? null })),
      allowSkip: input.allowSkip,
    },
  });
  return await getGrowthAdminInterviewBody(tenancy);
}

/**
 * Drops a weak question from a held plan, re-packing the remaining order indices.
 *
 * Re-packing matters because `orderIndex` is what the interview agent walks to find "the next
 * question"; a gap would not break it, but the plan's indices would stop matching the order a
 * reviewer sees, and the next edit would be made against the wrong row.
 */
export async function deleteGrowthAdminInterviewQuestion(tenancy: Tenancy, questionId: string) {
  const { run, question } = await requireQuestionInInterview(tenancy, questionId);
  assertInterviewIsEditable(run.interview);
  if (run.interview.questions.length <= 1) {
    throw new StatusError(400, "An interview needs at least one question. Regenerate the plan instead.");
  }
  await globalPrismaClient.$transaction(async (tx) => {
    await tx.growthInterviewQuestion.delete({ where: { id: question.id } });
    // One statement rather than a loop: the rows are few, but a loop would briefly leave two
    // questions sharing an index, and nothing stops a concurrent read from seeing that.
    await tx.growthInterviewQuestion.updateMany({
      where: { interviewId: run.interview.id, orderIndex: { gt: question.orderIndex } },
      data: { orderIndex: { decrement: 1 } },
    });
  });
  return await getGrowthAdminInterviewBody(tenancy);
}

/**
 * Hands the reviewed plan to the customer.
 *
 * The run is not touched: it has been sitting in AWAITING_INTERVIEW since the questions phase
 * finished, and it stays there — releasing changes who may answer, not where the run is. The
 * customer's dashboard picks this up on its next status poll, which is why nothing is enqueued here.
 */
export async function releaseGrowthInterview(tenancy: Tenancy, options: { releasedByUserId: string | null, now: Date }) {
  const run = await requireLatestGrowthInterview(tenancy);
  if (isGrowthInterviewReleased(run.interview)) {
    throw new StatusError(409, "This interview is already released.");
  }
  if (run.interview.questions.length === 0) {
    throw new StatusError(400, "This interview has no questions to release.");
  }
  await globalPrismaClient.growthInterview.update({
    where: { id: run.interview.id },
    data: { releasedAt: options.now, releasedByUserId: options.releasedByUserId },
  });
  return await getGrowthAdminInterviewBody(tenancy);
}

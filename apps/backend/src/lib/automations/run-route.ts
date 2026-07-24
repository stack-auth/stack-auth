import { captureError, HexclaveAssertionError, StatusError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { AutomationJson, AutomationRuleDisabledError, AutomationRuleNotFoundError, getSupportedAutomationRule, paymentsItemQuotaSourceType, sendEmailActionType } from "./rules";
import { AutomationActionPlan, AutomationEvaluationResult, AutomationSourceAdapter, AutomationActionAdapter, EvaluatedAutomationDecision, evaluateAutomationRule } from "./rule-evaluator";
import { paymentsItemQuotaSourceSnapshotToApiBody } from "./source-snapshot";

export type AutomationRuleExecutionClaimResult =
  | {
    claimed: true,
    lastActionAt: Date | null,
    emailOutboxId: string,
  }
  | {
    claimed: false,
    lastActionAt: Date | null,
    nextEligibleAt: Date,
    reason: "cooldown" | "in-flight" | "retry-backoff",
  };

export type AutomationRuleExecutionDeferralResult =
  | {
    outcome: "deferred",
    nextRetryAt: Date,
  }
  | {
    outcome: "already-completed",
    lastActionAt: Date,
  };

export type AutomationRuleExecutionStateStore = {
  claimExecution: (options: {
    tenancyId: string,
    ruleId: string,
    sourceType: typeof paymentsItemQuotaSourceType,
    actionType: typeof sendEmailActionType,
    subjectType: "user",
    subjectId: string,
    signalKey: string,
    lastTriggeredAt: Date,
    cooldownDays: number,
    sourceSnapshot: Record<string, AutomationJson>,
  }) => Promise<AutomationRuleExecutionClaimResult>,
  markActionCompleted: (options: {
    tenancyId: string,
    ruleId: string,
    subjectType: "user",
    subjectId: string,
    signalKey: string,
    claimTriggeredAt: Date,
    lastActionAt: Date,
    emailOutboxId: string,
  }) => Promise<void>,
  deferActionRetry: (options: {
    tenancyId: string,
    ruleId: string,
    subjectType: "user",
    subjectId: string,
    signalKey: string,
    claimTriggeredAt: Date,
    failedAt: Date,
    emailOutboxId: string,
  }) => Promise<AutomationRuleExecutionDeferralResult>,
};

export type AutomationEmailSendResult = {
  outcome: "created" | "already-enqueued",
};

export type AutomationEmailSender = (options: {
  action: AutomationActionPlan,
  scheduledAt: Date,
  emailOutboxId: string,
}) => Promise<AutomationEmailSendResult>;

export function getSingleAutomationEmailSendResult(result: {
  createdCount: number,
  alreadyEnqueuedCount: number,
}): AutomationEmailSendResult {
  if (result.createdCount === 1 && result.alreadyEnqueuedCount === 0) {
    return { outcome: "created" };
  }
  if (result.createdCount === 0 && result.alreadyEnqueuedCount === 1) {
    return { outcome: "already-enqueued" };
  }
  throw new Error(`Expected one automation email enqueue result, received ${result.createdCount} created and ${result.alreadyEnqueuedCount} already enqueued.`);
}

export type AutomationRunDecisionResult = {
  decision: EvaluatedAutomationDecision,
  outcome: "sent" | "suppressed" | "deferred",
  sent: boolean,
  cooldown: {
    blocked: boolean,
    lastActionAtMillis?: number,
    nextEligibleAtMillis?: number,
  },
  skipReason?: "cooldown" | "in-flight" | "retry-backoff",
  deferred?: {
    stage: "enqueue" | "completion",
    retryAtMillis: number,
  },
};

export type AutomationRunResult = {
  ruleId: string,
  mode: "run",
  evaluatedCount: number,
  eligibleCount: number,
  suppressedCount: number,
  sentCount: number,
  deferredCount: number,
  nextCursor: string | null,
  decisions: AutomationRunDecisionResult[],
};

export async function runAutomationRuleForRoute(options: {
  tenancy: Parameters<typeof evaluateAutomationRule>[0]["tenancy"],
  ruleId: string,
  limit?: number,
  cursor?: string | null,
  scheduledAt: Date,
  now: Date,
  // Claim ownership stays anchored to `now`; retry backoff starts when the failure is observed.
  failureNow?: () => Date,
  sourceAdapter: AutomationSourceAdapter,
  actionAdapter: AutomationActionAdapter,
  stateStore: AutomationRuleExecutionStateStore,
  emailSender: AutomationEmailSender,
}): Promise<AutomationRunResult> {
  const rule = getSupportedAutomationRule(options.tenancy, options.ruleId);
  if (!rule.enabled) {
    throw new AutomationRuleDisabledError(options.ruleId);
  }
  const evaluation = await evaluateAutomationRule({
    tenancy: options.tenancy,
    ruleId: options.ruleId,
    mode: "run",
    limit: options.limit,
    cursor: options.cursor,
    adapters: {
      sourceAdapters: {
        [paymentsItemQuotaSourceType]: options.sourceAdapter,
      },
      actionAdapters: {
        [sendEmailActionType]: options.actionAdapter,
      },
    },
  });

  const decisions: AutomationRunDecisionResult[] = [];
  for (const decision of evaluation.decisions) {
    const claim = await options.stateStore.claimExecution({
      tenancyId: options.tenancy.id,
      ruleId: options.ruleId,
      sourceType: rule.source.type,
      actionType: rule.action.type,
      subjectType: decision.subject.type,
      subjectId: decision.subject.id,
      signalKey: decision.signal.key,
      lastTriggeredAt: options.now,
      cooldownDays: rule.cooldown.days,
      sourceSnapshot: decision.sourceSnapshot,
    });

    if (!claim.claimed) {
      decisions.push({
        decision,
        outcome: "suppressed",
        sent: false,
        cooldown: {
          blocked: true,
          ...(claim.lastActionAt === null ? {} : { lastActionAtMillis: claim.lastActionAt.getTime() }),
          nextEligibleAtMillis: claim.nextEligibleAt.getTime(),
        },
        skipReason: claim.reason,
      });
      continue;
    }

    const sendResult = await Result.fromThrowingAsync(async () => await options.emailSender({
      action: decision.action,
      scheduledAt: options.scheduledAt,
      emailOutboxId: claim.emailOutboxId,
    }));
    if (sendResult.status === "error") {
      const deferral = await options.stateStore.deferActionRetry({
        tenancyId: options.tenancy.id,
        ruleId: options.ruleId,
        subjectType: decision.subject.type,
        subjectId: decision.subject.id,
        signalKey: decision.signal.key,
        claimTriggeredAt: options.now,
        failedAt: options.failureNow?.() ?? new Date(),
        emailOutboxId: claim.emailOutboxId,
      });
      if (deferral.outcome === "already-completed") {
        decisions.push(createSentDecisionResult(decision));
        continue;
      }
      reportDeferredAutomationDecision(options, decision, "enqueue", sendResult.error);
      decisions.push(createDeferredDecisionResult(decision, "enqueue", deferral.nextRetryAt));
      continue;
    }

    const completionResult = await Result.fromThrowingAsync(async () => await options.stateStore.markActionCompleted({
      tenancyId: options.tenancy.id,
      ruleId: options.ruleId,
      subjectType: decision.subject.type,
      subjectId: decision.subject.id,
      signalKey: decision.signal.key,
      claimTriggeredAt: options.now,
      lastActionAt: options.now,
      emailOutboxId: claim.emailOutboxId,
    }));
    if (completionResult.status === "error") {
      const deferral = await options.stateStore.deferActionRetry({
        tenancyId: options.tenancy.id,
        ruleId: options.ruleId,
        subjectType: decision.subject.type,
        subjectId: decision.subject.id,
        signalKey: decision.signal.key,
        claimTriggeredAt: options.now,
        failedAt: options.failureNow?.() ?? new Date(),
        emailOutboxId: claim.emailOutboxId,
      });
      if (deferral.outcome === "already-completed") {
        decisions.push(createSentDecisionResult(decision));
        continue;
      }
      reportDeferredAutomationDecision(options, decision, "completion", completionResult.error);
      decisions.push(createDeferredDecisionResult(decision, "completion", deferral.nextRetryAt));
      continue;
    }

    decisions.push(createSentDecisionResult(decision));
  }

  const sentCount = decisions.filter((decision) => decision.outcome === "sent").length;
  const suppressedCount = decisions.filter((decision) => decision.outcome === "suppressed").length;
  const deferredCount = decisions.filter((decision) => decision.outcome === "deferred").length;

  return {
    ruleId: options.ruleId,
    mode: "run",
    evaluatedCount: evaluation.evaluatedCount,
    eligibleCount: sentCount + deferredCount,
    suppressedCount,
    sentCount,
    deferredCount,
    nextCursor: evaluation.nextCursor,
    decisions,
  };
}

export async function runAutomationRuleForManualRoute(
  options: Parameters<typeof runAutomationRuleForRoute>[0],
): Promise<AutomationRunResult> {
  try {
    return await runAutomationRuleForRoute(options);
  } catch (error) {
    if (error instanceof AutomationRuleNotFoundError) {
      throw new StatusError(StatusError.NotFound, error.message);
    }
    if (error instanceof AutomationRuleDisabledError) {
      throw new StatusError(StatusError.Conflict, error.message);
    }
    throw error;
  }
}

export function automationRunResultToApiBody(result: AutomationRunResult) {
  return {
    rule_id: result.ruleId,
    mode: result.mode,
    evaluated_count: result.evaluatedCount,
    eligible_count: result.eligibleCount,
    suppressed_count: result.suppressedCount,
    sent_count: result.sentCount,
    deferred_count: result.deferredCount,
    next_cursor: result.nextCursor,
    decisions: result.decisions.map((resultDecision) => ({
      subject_type: resultDecision.decision.subject.type,
      subject_id: resultDecision.decision.subject.id,
      signal_key: resultDecision.decision.signal.key,
      sent: resultDecision.sent,
      outcome: resultDecision.outcome,
      source: paymentsItemQuotaSourceSnapshotToApiBody(resultDecision.decision, "Automation run decision"),
      action: {
        type: resultDecision.decision.action.type,
        template_id: resultDecision.decision.action.templateId,
        notification_category_name: resultDecision.decision.action.notificationCategoryName,
      },
      cooldown: {
        blocked: resultDecision.cooldown.blocked,
        ...(resultDecision.cooldown.lastActionAtMillis === undefined ? {} : {
          last_action_at_millis: resultDecision.cooldown.lastActionAtMillis,
        }),
        ...(resultDecision.cooldown.nextEligibleAtMillis === undefined ? {} : {
          next_eligible_at_millis: resultDecision.cooldown.nextEligibleAtMillis,
        }),
      },
      ...(resultDecision.skipReason === undefined ? {} : { skip_reason: resultDecision.skipReason }),
      ...(resultDecision.deferred === undefined ? {} : {
        deferred: {
          stage: resultDecision.deferred.stage,
          retry_at_millis: resultDecision.deferred.retryAtMillis,
        },
      }),
    })),
  };
}

function createSentDecisionResult(decision: EvaluatedAutomationDecision): AutomationRunDecisionResult {
  return {
    decision,
    outcome: "sent",
    sent: true,
    cooldown: { blocked: false },
  };
}

function createDeferredDecisionResult(
  decision: EvaluatedAutomationDecision,
  stage: "enqueue" | "completion",
  nextRetryAt: Date,
): AutomationRunDecisionResult {
  return {
    decision,
    outcome: "deferred",
    sent: false,
    cooldown: {
      blocked: true,
      nextEligibleAtMillis: nextRetryAt.getTime(),
    },
    deferred: {
      stage,
      retryAtMillis: nextRetryAt.getTime(),
    },
  };
}

function reportDeferredAutomationDecision(
  options: Pick<Parameters<typeof runAutomationRuleForRoute>[0], "tenancy" | "ruleId">,
  decision: EvaluatedAutomationDecision,
  stage: "enqueue" | "completion",
  cause: unknown,
) {
  captureError("automation-decision-deferred", new HexclaveAssertionError(`Deferred automation decision after ${stage} failed.`, {
    cause,
    tenancyId: options.tenancy.id,
    ruleId: options.ruleId,
    subjectType: decision.subject.type,
    subjectId: decision.subject.id,
    signalKey: decision.signal.key,
    stage,
  }));
}

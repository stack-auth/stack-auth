import { AutomationJson, getSupportedAutomationRule, paymentsItemQuotaSourceType, sendEmailActionType } from "./rules";
import { AutomationActionPlan, AutomationEvaluationResult, AutomationSourceAdapter, AutomationActionAdapter, EvaluatedAutomationDecision, evaluateAutomationRule } from "./rule-evaluator";

export type AutomationRuleExecutionClaimResult =
  | {
    claimed: true,
    lastActionAt: Date | null,
  }
  | {
    claimed: false,
    lastActionAt: Date | null,
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
    lastActionAt: Date,
    lastEmailOutboxId: string | null,
  }) => Promise<void>,
};

export type AutomationEmailSender = (options: {
  action: AutomationActionPlan,
  scheduledAt: Date,
}) => Promise<void>;

export type AutomationRunDecisionResult = {
  decision: EvaluatedAutomationDecision,
  sent: boolean,
  cooldown: {
    blocked: boolean,
    lastActionAtMillis?: number,
    nextEligibleAtMillis?: number,
  },
  skipReason?: "cooldown",
};

export type AutomationRunResult = {
  ruleId: string,
  mode: "run",
  evaluatedCount: number,
  eligibleCount: number,
  suppressedCount: number,
  sentCount: number,
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
  sourceAdapter: AutomationSourceAdapter,
  actionAdapter: AutomationActionAdapter,
  stateStore: AutomationRuleExecutionStateStore,
  emailSender: AutomationEmailSender,
}): Promise<AutomationRunResult> {
  const rule = getSupportedAutomationRule(options.tenancy, options.ruleId);
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
        sent: false,
        cooldown: getBlockedCooldownDetails(claim.lastActionAt, rule.cooldown.days),
        skipReason: "cooldown",
      });
      continue;
    }

    await options.emailSender({
      action: decision.action,
      scheduledAt: options.scheduledAt,
    });
    await options.stateStore.markActionCompleted({
      tenancyId: options.tenancy.id,
      ruleId: options.ruleId,
      subjectType: decision.subject.type,
      subjectId: decision.subject.id,
      signalKey: decision.signal.key,
      lastActionAt: options.now,
      lastEmailOutboxId: null,
    });

    decisions.push({
      decision,
      sent: true,
      cooldown: {
        blocked: false,
      },
    });
  }

  const sentCount = decisions.filter((decision) => decision.sent).length;
  const suppressedCount = decisions.length - sentCount;

  return {
    ruleId: options.ruleId,
    mode: "run",
    evaluatedCount: evaluation.evaluatedCount,
    eligibleCount: sentCount,
    suppressedCount,
    sentCount,
    nextCursor: evaluation.nextCursor,
    decisions,
  };
}

export function automationRunResultToApiBody(result: AutomationRunResult) {
  return {
    rule_id: result.ruleId,
    mode: result.mode,
    evaluated_count: result.evaluatedCount,
    eligible_count: result.eligibleCount,
    suppressed_count: result.suppressedCount,
    sent_count: result.sentCount,
    next_cursor: result.nextCursor,
    decisions: result.decisions.map((resultDecision) => ({
      subject_type: resultDecision.decision.subject.type,
      subject_id: resultDecision.decision.subject.id,
      signal_key: resultDecision.decision.signal.key,
      sent: resultDecision.sent,
      source: {
        type: "payments-item-quota",
        item_id: getStringSourceSnapshotValue(resultDecision.decision, "itemId"),
        current_quantity: getNumberSourceSnapshotValue(resultDecision.decision, "currentQuantity"),
        entitlement_quantity: getNullableNumberSourceSnapshotValue(resultDecision.decision, "entitlementQuantity"),
        threshold_kind: resultDecision.decision.signal.kind,
        owned_product_ids: getStringArraySourceSnapshotValue(resultDecision.decision, "ownedProductIds"),
        active_subscription_ids: getStringArraySourceSnapshotValue(resultDecision.decision, "activeSubscriptionIds"),
      },
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
    })),
  };
}

function getBlockedCooldownDetails(lastActionAt: Date | null, cooldownDays: number) {
  if (lastActionAt === null) {
    return {
      blocked: true,
    };
  }
  const nextEligibleAtMillis = lastActionAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000;
  return {
    blocked: true,
    lastActionAtMillis: lastActionAt.getTime(),
    nextEligibleAtMillis,
  };
}

function getStringSourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string) {
  const value = decision.sourceSnapshot[key];
  if (typeof value !== "string") {
    throw new Error(`Automation run decision sourceSnapshot.${key} must be a string.`);
  }
  return value;
}

function getNumberSourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string) {
  const value = decision.sourceSnapshot[key];
  if (typeof value !== "number") {
    throw new Error(`Automation run decision sourceSnapshot.${key} must be a number.`);
  }
  return value;
}

function getNullableNumberSourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string) {
  const value = decision.sourceSnapshot[key];
  if (value !== null && typeof value !== "number") {
    throw new Error(`Automation run decision sourceSnapshot.${key} must be a number or null.`);
  }
  return value;
}

function getStringArraySourceSnapshotValue(decision: EvaluatedAutomationDecision, key: string) {
  const value = decision.sourceSnapshot[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new Error(`Automation run decision sourceSnapshot.${key} must be an array of strings.`);
  }
  return value;
}

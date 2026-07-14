import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { automationCooldownStatusToApiBody, type AutomationCooldownStatus } from "./cooldown";
import { AutomationRuleExecutionStateReader } from "./execution-state-store";
import { AutomationActionAdapter, AutomationEvaluationResult, AutomationSourceAdapter, EvaluatedAutomationDecision, evaluateAutomationRule } from "./rule-evaluator";
import { AutomationRuleNotFoundError, AutomationRuleTenancy, getSupportedAutomationRule, paymentsItemQuotaSourceType, sendEmailActionType } from "./rules";
import { PaymentsItemQuotaSourceApiBody, paymentsItemQuotaSourceSnapshotToApiBody } from "./source-snapshot";

export type AutomationDryRunRecipientStatus = {
  userExists: boolean,
  hasPrimaryEmail: boolean,
};

export type AutomationDryRunRecipientStatusReader<TPrisma> = (options: {
  prisma: TPrisma,
  tenancyId: string,
  userIds: string[],
}) => Promise<Map<string, AutomationDryRunRecipientStatus>>;

type AutomationDryRunDecisionApiItem = {
  subject_type: "user",
  subject_id: string,
  source: PaymentsItemQuotaSourceApiBody,
  action: {
    type: "send-email",
    template_id: string,
    notification_category_name: "Marketing",
  },
  cooldown: {
    blocked: boolean,
    last_action_at_millis?: number,
    next_eligible_at_millis?: number,
  },
  recipient: {
    user_exists: boolean,
    has_primary_email: boolean,
  },
};

type AutomationDryRunApiBody = {
  rule_id: string,
  mode: "dry-run",
  evaluated_count: number,
  eligible_count: number,
  suppressed_count: number,
  next_cursor: string | null,
  decisions: AutomationDryRunDecisionApiItem[],
};

export async function evaluateAutomationRuleDryRunForRoute<TPrisma>(options: {
  tenancy: Parameters<typeof evaluateAutomationRule>[0]["tenancy"],
  ruleId: string,
  limit?: number,
  cursor?: string | null,
  prisma: TPrisma,
  sourceAdapter: AutomationSourceAdapter,
  actionAdapter: AutomationActionAdapter,
  recipientStatusReader: AutomationDryRunRecipientStatusReader<TPrisma>,
  executionStateReader: AutomationRuleExecutionStateReader,
  now: Date,
}) {
  const rule = getSupportedAutomationRuleForDryRunRoute(options.tenancy, options.ruleId);
  const result = await evaluateAutomationRule({
    tenancy: options.tenancy,
    ruleId: options.ruleId,
    mode: "dry-run",
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

  const recipientStatuses = await options.recipientStatusReader({
    prisma: options.prisma,
    tenancyId: options.tenancy.id,
    userIds: result.decisions.map((decision) => decision.subject.id),
  });
  const cooldownStatuses = await Promise.all(result.decisions.map(async (decision) => await options.executionStateReader.getCooldownStatus({
    tenancyId: options.tenancy.id,
    ruleId: options.ruleId,
    subjectType: decision.subject.type,
    subjectId: decision.subject.id,
    signalKey: decision.signal.key,
    cooldownDays: rule.cooldown.days,
    now: options.now,
  })));

  return automationDryRunResultToApiBody(result, recipientStatuses, cooldownStatuses);
}

function getSupportedAutomationRuleForDryRunRoute(tenancy: AutomationRuleTenancy, ruleId: string) {
  try {
    return getSupportedAutomationRule(tenancy, ruleId);
  } catch (error) {
    if (error instanceof AutomationRuleNotFoundError) {
      throw new StatusError(StatusError.NotFound, error.message);
    }
    throw error;
  }
}

export function automationDryRunResultToApiBody(
  result: AutomationEvaluationResult,
  recipientStatuses: Map<string, AutomationDryRunRecipientStatus>,
  cooldownStatuses: AutomationCooldownStatus[],
): AutomationDryRunApiBody {
  const blockedCount = cooldownStatuses.filter((status) => status.blocked).length;
  return {
    rule_id: result.ruleId,
    mode: "dry-run",
    evaluated_count: result.evaluatedCount,
    eligible_count: result.decisions.length - blockedCount,
    suppressed_count: blockedCount,
    next_cursor: result.nextCursor,
    decisions: result.decisions.map((decision, index) => automationDryRunDecisionToApiItem(decision, recipientStatuses.get(decision.subject.id) ?? {
      userExists: false,
      hasPrimaryEmail: false,
    }, cooldownStatuses[index] ?? {
      blocked: false,
    })),
  };
}

function automationDryRunDecisionToApiItem(
  decision: EvaluatedAutomationDecision,
  recipientStatus: AutomationDryRunRecipientStatus,
  cooldownStatus: AutomationCooldownStatus,
): AutomationDryRunDecisionApiItem {
  return {
    subject_type: decision.subject.type,
    subject_id: decision.subject.id,
    source: paymentsItemQuotaSourceSnapshotToApiBody(decision, "Automation dry-run decision"),
    action: {
      type: decision.action.type,
      template_id: decision.action.templateId,
      notification_category_name: decision.action.notificationCategoryName,
    },
    cooldown: automationCooldownStatusToApiBody(cooldownStatus),
    recipient: {
      user_exists: recipientStatus.userExists,
      has_primary_email: recipientStatus.hasPrimaryEmail,
    },
  };
}

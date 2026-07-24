export type AutomationCooldownStatus =
  | {
    blocked: false,
  }
  | {
    blocked: true,
    lastActionAt: Date,
    nextEligibleAt: Date,
  };

export function getAutomationCooldownStatus(options: {
  lastActionAt: Date | null | undefined,
  cooldownDays: number,
  now: Date,
}): AutomationCooldownStatus {
  if (options.lastActionAt == null) {
    return {
      blocked: false,
    };
  }

  const nextEligibleAt = new Date(options.lastActionAt.getTime() + options.cooldownDays * 24 * 60 * 60 * 1000);
  if (options.now.getTime() <= nextEligibleAt.getTime()) {
    return {
      blocked: true,
      lastActionAt: options.lastActionAt,
      nextEligibleAt,
    };
  }

  return {
    blocked: false,
  };
}

export function automationCooldownStatusToApiBody(status: AutomationCooldownStatus) {
  return status.blocked
    ? {
      blocked: true,
      last_action_at_millis: status.lastActionAt.getTime(),
      next_eligible_at_millis: status.nextEligibleAt.getTime(),
    }
    : {
      blocked: false,
    };
}

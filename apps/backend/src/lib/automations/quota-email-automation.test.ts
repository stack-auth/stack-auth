import { describe, expect, it, vi } from "vitest";
import { buildSendEmailActionPlan } from "./actions/send-email";
import { AutomationActionAdapter, AutomationSourceAdapter, AutomationSourceDecision, evaluateAutomationRule } from "./rule-evaluator";
import {
  createPaymentsItemQuotaSourceAdapter,
  PaymentsItemQuotaCustomerDataReaders,
  PaymentsItemQuotaOwnedProduct,
  PaymentsItemQuotaProjectUserReader,
  PaymentsItemQuotaSubscription,
} from "./sources/payments-item-quota";
import { AutomationRuleConfig, AutomationRuleTenancy, getSupportedAutomationRule, paymentsItemQuotaSourceType, sendEmailActionType } from "./rules";

const ruleId = "low-api-credits";

function createRule(overrides: {
  sourceType?: string,
  customerType?: string,
  actionType?: string,
  templateId?: string,
  themeId?: string | null,
  subject?: string,
} = {}): AutomationRuleConfig {
  return {
    displayName: "Low API credits",
    enabled: true,
    source: {
      type: overrides.sourceType ?? paymentsItemQuotaSourceType,
      itemId: "api_credits",
      customerType: overrides.customerType ?? "user",
      thresholds: {
        nearRemainingQuantity: 10,
      },
    },
    action: {
      type: overrides.actionType ?? sendEmailActionType,
      templateId: overrides.templateId ?? "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
      themeId: overrides.themeId,
      subject: overrides.subject,
      notificationCategoryName: "Marketing",
    },
    cooldown: {
      days: 7,
    },
  };
}

function createTenancy(rule: AutomationRuleConfig | null = createRule()): AutomationRuleTenancy {
  return {
    id: "tenancy-1",
    config: {
      automations: {
        rules: rule === null ? {} : {
          [ruleId]: rule,
        },
      },
    },
  };
}

function createAdapters() {
  const evaluateSource: AutomationSourceAdapter["evaluate"] = async () => ({
    evaluatedCount: 2,
    nextCursor: "cursor-2",
    decisions: [{
      subject: {
        type: "user",
        id: "user-1",
      },
      signal: {
        key: "api_credits:near",
        kind: "near",
      },
      sourceSnapshot: {
        itemId: "api_credits",
        currentQuantity: 7,
        entitlementQuantity: 100,
      },
    }],
  });
  const buildActionPlan: AutomationActionAdapter["buildPlan"] = async (options) => ({
    type: sendEmailActionType,
    recipient: {
      type: "user-primary-email",
      userId: options.decision.subject.id,
    },
    templateId: options.rule.action.templateId,
    tsxSource: "export function EmailTemplate() { return null; }",
    themeId: null,
    notificationCategoryName: "Marketing",
    notificationCategoryId: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
    createdWith: {
      type: "programmatic-call",
      templateId: options.rule.action.templateId,
    },
    isHighPriority: false,
    shouldSkipDeliverabilityCheck: false,
    variables: {
      automationRuleId: options.ruleId,
      thresholdKind: options.decision.signal.kind,
    },
  });
  const sourceAdapter: AutomationSourceAdapter = {
    evaluate: vi.fn(evaluateSource),
  };
  const actionAdapter: AutomationActionAdapter = {
    buildPlan: vi.fn(buildActionPlan),
  };

  return {
    sourceAdapter,
    actionAdapter,
    adapters: {
      sourceAdapters: {
        [paymentsItemQuotaSourceType]: sourceAdapter,
      },
      actionAdapters: {
        [sendEmailActionType]: actionAdapter,
      },
    },
  };
}

describe("automation evaluator skeleton", () => {
  it("dispatches a valid V1 rule to the payments item quota source adapter", async () => {
    const { sourceAdapter, adapters } = createAdapters();

    await evaluateAutomationRule({
      tenancy: createTenancy(),
      ruleId,
      mode: "dry-run",
      limit: 25,
      cursor: "cursor-1",
      adapters,
    });

    expect(sourceAdapter.evaluate).toHaveBeenCalledTimes(1);
    expect(sourceAdapter.evaluate).toHaveBeenCalledWith(expect.objectContaining({
      ruleId,
      limit: 25,
      cursor: "cursor-1",
      rule: expect.objectContaining({
        source: expect.objectContaining({
          type: paymentsItemQuotaSourceType,
        }),
      }),
    }));
  });

  it("dispatches source decisions to the send-email action adapter", async () => {
    const { actionAdapter, adapters } = createAdapters();

    await evaluateAutomationRule({
      tenancy: createTenancy(),
      ruleId,
      mode: "dry-run",
      adapters,
    });

    expect(actionAdapter.buildPlan).toHaveBeenCalledTimes(1);
    expect(actionAdapter.buildPlan).toHaveBeenCalledWith(expect.objectContaining({
      ruleId,
      decision: expect.objectContaining({
        subject: {
          type: "user",
          id: "user-1",
        },
      }),
    }));
  });

  it("returns combined dry-run decisions with source snapshot and action plan", async () => {
    const { adapters } = createAdapters();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy(),
      ruleId,
      mode: "dry-run",
      adapters,
    })).resolves.toMatchInlineSnapshot(`
      {
        "decisions": [
          {
            "action": {
              "createdWith": {
                "templateId": "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
                "type": "programmatic-call",
              },
              "isHighPriority": false,
              "notificationCategoryId": "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
              "notificationCategoryName": "Marketing",
              "recipient": {
                "type": "user-primary-email",
                "userId": "user-1",
              },
              "shouldSkipDeliverabilityCheck": false,
              "templateId": "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
              "themeId": null,
              "tsxSource": "export function EmailTemplate() { return null; }",
              "type": "send-email",
              "variables": {
                "automationRuleId": "low-api-credits",
                "thresholdKind": "near",
              },
            },
            "signal": {
              "key": "api_credits:near",
              "kind": "near",
            },
            "sourceSnapshot": {
              "currentQuantity": 7,
              "entitlementQuantity": 100,
              "itemId": "api_credits",
            },
            "subject": {
              "id": "user-1",
              "type": "user",
            },
          },
        ],
        "eligibleCount": 1,
        "evaluatedCount": 2,
        "mode": "dry-run",
        "nextCursor": "cursor-2",
        "ruleId": "low-api-credits",
        "suppressedCount": 0,
      }
    `);
  });

  it("fails loudly for a missing rule", async () => {
    const { adapters } = createAdapters();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy(null),
      ruleId,
      mode: "dry-run",
      adapters,
    })).rejects.toThrow('Automation rule "low-api-credits" was not found for tenancy "tenancy-1".');
  });

  it("fails loudly for unsupported source.type", async () => {
    const { adapters } = createAdapters();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy(createRule({ sourceType: "client-push-quota" })),
      ruleId,
      mode: "dry-run",
      adapters,
    })).rejects.toThrow('Automation rule "low-api-credits" has unsupported source.type "client-push-quota". V1 supports only "payments-item-quota".');
  });

  it("fails loudly for unsupported source.customerType", async () => {
    const { adapters } = createAdapters();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy(createRule({ customerType: "team" })),
      ruleId,
      mode: "dry-run",
      adapters,
    })).rejects.toThrow('Automation rule "low-api-credits" has unsupported source.customerType "team". V1 supports only "user".');
  });

  it("fails loudly for unsupported action.type", async () => {
    const { adapters } = createAdapters();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy(createRule({ actionType: "webhook" })),
      ruleId,
      mode: "dry-run",
      adapters,
    })).rejects.toThrow('Automation rule "low-api-credits" has unsupported action.type "webhook". V1 supports only "send-email".');
  });

  it("fails loudly when source.thresholds has no configured values", async () => {
    const { adapters } = createAdapters();
    const rule = createRule();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy({
        ...rule,
        source: {
          ...rule.source,
          thresholds: {},
        },
      }),
      ruleId,
      mode: "dry-run",
      adapters,
    })).rejects.toThrow('Automation rule "low-api-credits" must configure at least one source.thresholds value.');
  });

  it("uses the same evaluator dispatch path for real-send mode", async () => {
    const { sourceAdapter, actionAdapter, adapters } = createAdapters();

    await expect(evaluateAutomationRule({
      tenancy: createTenancy(),
      ruleId,
      mode: "run",
      adapters,
    })).resolves.toMatchObject({
      mode: "run",
      eligibleCount: 1,
    });

    expect(sourceAdapter.evaluate).toHaveBeenCalledTimes(1);
    expect(actionAdapter.buildPlan).toHaveBeenCalledTimes(1);
  });

  it("keeps dry-run evaluation independent from Prisma state", async () => {
    const { adapters } = createAdapters();

    const result = await evaluateAutomationRule({
      tenancy: createTenancy(),
      ruleId,
      mode: "dry-run",
      adapters,
    });

    expect(result.suppressedCount).toBe(0);
    expect(result.decisions).toHaveLength(1);
  });
});

type FakePrisma = {
  label: "fake-prisma",
};

type SourceTestState = {
  projectUserIds: string[],
  nextCursor?: string | null,
  currentQuantities?: Record<string, number | undefined>,
  ownedProducts?: Record<string, Record<string, PaymentsItemQuotaOwnedProduct>>,
  subscriptions?: Record<string, Record<string, PaymentsItemQuotaSubscription>>,
};

const fakePrisma: FakePrisma = {
  label: "fake-prisma",
};

function createSourceTenancy(options: {
  itemCustomerType?: string,
  thresholds?: NonNullable<AutomationRuleConfig["source"]["thresholds"]>,
  itemExists?: boolean,
} = {}): AutomationRuleTenancy {
  return {
    id: "tenancy-1",
    config: {
      automations: {
        rules: {
          [ruleId]: createRule(),
        },
      },
      payments: {
        items: options.itemExists === false ? {} : {
          api_credits: {
            displayName: "API credits",
            customerType: options.itemCustomerType ?? "user",
          },
        },
      },
    },
  };
}

function createSourceRule(tenancy: AutomationRuleTenancy, thresholds: NonNullable<AutomationRuleConfig["source"]["thresholds"]>) {
  const rule = getSupportedAutomationRule(tenancy, ruleId);
  return {
    ...rule,
    source: {
      ...rule.source,
      thresholds,
    },
  };
}

function createOwnedProduct(options: {
  quantity?: number,
  includedQuantity?: number,
} = {}): PaymentsItemQuotaOwnedProduct {
  return {
    quantity: options.quantity ?? 1,
    productLineId: "line-1",
    product: {
      includedItems: {
        api_credits: {
          quantity: options.includedQuantity ?? 100,
        },
      },
    },
  };
}

function createSourceAdapterFixture(state: SourceTestState) {
  const projectUserReader: PaymentsItemQuotaProjectUserReader<FakePrisma> = {
    listCandidateUserIds: vi.fn(async () => ({
      projectUserIds: state.projectUserIds,
      nextCursor: state.nextCursor ?? null,
    })),
  };
  const customerDataReaders: PaymentsItemQuotaCustomerDataReaders<FakePrisma> = {
    getItemQuantityForCustomer: vi.fn(async (options) => state.currentQuantities?.[options.customerId] ?? 50),
    getOwnedProductsForCustomer: vi.fn(async (options) => state.ownedProducts?.[options.customerId] ?? {
      pro: createOwnedProduct(),
    }),
    getSubscriptionMapForCustomer: vi.fn(async (options) => state.subscriptions?.[options.customerId] ?? {}),
  };
  const adapter = createPaymentsItemQuotaSourceAdapter({
    prisma: fakePrisma,
    projectUserReader,
    customerDataReaders,
  });
  return {
    adapter,
    projectUserReader,
    customerDataReaders,
  };
}

describe("payments item quota source adapter", () => {
  it("rejects a rule whose configured item does not exist", async () => {
    const tenancy = createSourceTenancy({ itemExists: false });
    const { adapter } = createSourceAdapterFixture({ projectUserIds: ["user-1"] });

    await expect(adapter.evaluate({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
    })).rejects.toThrow('Automation rule "low-api-credits" references payments item "api_credits", but that item does not exist.');
  });

  it("rejects a payments item with a non-user customer type", async () => {
    const tenancy = createSourceTenancy({ itemCustomerType: "team" });
    const { adapter } = createSourceAdapterFixture({ projectUserIds: ["user-1"] });

    await expect(adapter.evaluate({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
    })).rejects.toThrow('Automation rule "low-api-credits" references payments item "api_credits" with customerType "team"; V1 supports only user items.');
  });

  it("detects near threshold by absolute remaining quantity", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { nearRemainingQuantity: 10 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1", "user-2"],
      currentQuantities: {
        "user-1": 9,
        "user-2": 11,
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      evaluatedCount: 2,
      decisions: [{
        subject: {
          type: "user",
          id: "user-1",
        },
        signal: {
          key: "api_credits:near",
          kind: "near",
        },
      }],
    });
  });

  it("does not emit an implicit over signal for near-only absolute thresholds at zero quantity", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { nearRemainingQuantity: 10 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1"],
      currentQuantities: {
        "user-1": 0,
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      decisions: [{
        signal: {
          key: "api_credits:near",
          kind: "near",
        },
      }],
    });
  });

  it("detects near threshold by remaining ratio", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { nearRemainingRatio: 0.2 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1"],
      currentQuantities: {
        "user-1": 15,
      },
      ownedProducts: {
        "user-1": {
          pro: createOwnedProduct({ quantity: 1, includedQuantity: 100 }),
        },
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      decisions: [{
        signal: {
          key: "api_credits:near",
          kind: "near",
        },
      }],
    });
  });

  it("does not emit an implicit over signal for near-only ratio thresholds at zero quantity", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { nearRemainingRatio: 0.2 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1"],
      currentQuantities: {
        "user-1": 0,
      },
      ownedProducts: {
        "user-1": {
          pro: createOwnedProduct({ quantity: 1, includedQuantity: 100 }),
        },
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      decisions: [{
        signal: {
          key: "api_credits:near",
          kind: "near",
        },
      }],
    });
  });

  it("detects over threshold", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { overLimitQuantity: 0 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1"],
      currentQuantities: {
        "user-1": 0,
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      decisions: [{
        signal: {
          key: "api_credits:over",
          kind: "over",
        },
      }],
    });
  });

  it("lets over threshold win over near threshold", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, {
      overLimitQuantity: 0,
      nearRemainingQuantity: 10,
      nearRemainingRatio: 0.2,
    });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1"],
      currentQuantities: {
        "user-1": 0,
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      decisions: [{
        signal: {
          key: "api_credits:over",
          kind: "over",
        },
      }],
    });
  });

  it("ignores ratio threshold when entitlement quantity is missing or zero", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { nearRemainingRatio: 0.2 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["missing-entitlement", "zero-entitlement"],
      currentQuantities: {
        "missing-entitlement": 1,
        "zero-entitlement": 1,
      },
      ownedProducts: {
        "missing-entitlement": {
          pro: {
            quantity: 1,
            productLineId: "line-1",
            product: {
              includedItems: {},
            },
          },
        },
        "zero-entitlement": {
          pro: createOwnedProduct({ includedQuantity: 0 }),
        },
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule })).resolves.toMatchObject({
      evaluatedCount: 2,
      decisions: [],
    });
  });

  it("includes item, quantity, product, and subscription context in the source snapshot", async () => {
    const tenancy = createSourceTenancy();
    const rule = createSourceRule(tenancy, { nearRemainingRatio: 0.2 });
    const { adapter } = createSourceAdapterFixture({
      projectUserIds: ["user-1"],
      currentQuantities: {
        "user-1": 10,
      },
      ownedProducts: {
        "user-1": {
          pro: createOwnedProduct({ quantity: 2, includedQuantity: 50 }),
          __null__: createOwnedProduct({ quantity: 1, includedQuantity: 1 }),
        },
      },
      subscriptions: {
        "user-1": {
          sub_active: { status: "active" },
          sub_trial: { status: "trialing" },
          sub_canceled: { status: "canceled" },
        },
      },
    });

    await expect(adapter.evaluate({ tenancy, ruleId, rule, limit: 1, cursor: "previous-user" })).resolves.toMatchInlineSnapshot(`
      {
        "decisions": [
          {
            "signal": {
              "key": "api_credits:near",
              "kind": "near",
            },
            "sourceSnapshot": {
              "activeSubscriptionIds": [
                "sub_active",
                "sub_trial",
              ],
              "currentQuantity": 10,
              "entitlementQuantity": 101,
              "itemDisplayName": "API credits",
              "itemId": "api_credits",
              "ownedProductIds": [
                "pro",
              ],
              "sourceType": "payments-item-quota",
              "thresholdKind": "near",
            },
            "subject": {
              "id": "user-1",
              "type": "user",
            },
          },
        ],
        "evaluatedCount": 1,
        "nextCursor": null,
      }
    `);
  });
});

function createActionTenancy(rule: AutomationRuleConfig = createRule()): AutomationRuleTenancy {
  return {
    id: "tenancy-1",
    project: {
      display_name: "Acme App",
    },
    config: {
      automations: {
        rules: {
          [ruleId]: rule,
        },
      },
      emails: {
        selectedThemeId: "active-theme-id",
        templates: {
          "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1": {
            displayName: "Upgrade email",
            tsxSource: "export function EmailTemplate() { return null; }",
            themeId: "template-theme-id",
          },
        },
      },
    },
  };
}

function createActionDecision(): AutomationSourceDecision {
  return {
    subject: {
      type: "user",
      id: "user-1",
    },
    signal: {
      key: "api_credits:near",
      kind: "near",
    },
    sourceSnapshot: {
      sourceType: "payments-item-quota",
      itemId: "api_credits",
      itemDisplayName: "API credits",
      currentQuantity: 7,
      entitlementQuantity: 100,
      thresholdKind: "near",
      ownedProductIds: ["pro"],
      activeSubscriptionIds: ["sub_1"],
    },
  };
}

function buildTestSendEmailActionPlan(options: Omit<Parameters<typeof buildSendEmailActionPlan>[0], "getNotificationCategoryByName">) {
  return buildSendEmailActionPlan({
    ...options,
    getNotificationCategoryByName: async (name) => name === "Marketing" ? {
      id: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
      name: "Marketing",
    } : undefined,
  });
}

describe("send-email action adapter", () => {
  it("builds a user-primary-email recipient", async () => {
    const tenancy = createActionTenancy();

    await expect(buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    })).resolves.toMatchObject({
      recipient: {
        type: "user-primary-email",
        userId: "user-1",
      },
    });
  });

  it("uses the configured template, theme, and subject", async () => {
    const tenancy = createActionTenancy(createRule({
      themeId: "rule-theme-id",
      subject: "Upgrade your API credits",
    }));

    await expect(buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    })).resolves.toMatchObject({
      templateId: "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
      tsxSource: "export function EmailTemplate() { return null; }",
      themeId: "rule-theme-id",
      subject: "Upgrade your API credits",
      createdWith: {
        type: "programmatic-call",
        templateId: "8c6f6960-7a87-4ebd-b2a6-bfd06d68e2d1",
      },
    });
  });

  it("falls back to the template theme when the rule has no theme override", async () => {
    const tenancy = createActionTenancy();

    await expect(buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    })).resolves.toMatchObject({
      themeId: "template-theme-id",
    });
  });

  it("applies the Marketing notification category and outbox safety flags", async () => {
    const tenancy = createActionTenancy();

    await expect(buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    })).resolves.toMatchObject({
      notificationCategoryName: "Marketing",
      notificationCategoryId: "4f6f8873-3d04-46bd-8bef-18338b1a1b4c",
      isHighPriority: false,
      shouldSkipDeliverabilityCheck: false,
    });
  });

  it("includes source snapshot variables and project display name", async () => {
    const tenancy = createActionTenancy();

    await expect(buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    })).resolves.toMatchObject({
      variables: {
        automationRuleId: "low-api-credits",
        sourceType: "payments-item-quota",
        itemId: "api_credits",
        itemDisplayName: "API credits",
        currentQuantity: 7,
        entitlementQuantity: 100,
        thresholdKind: "near",
        ownedProductIds: ["pro"],
        activeSubscriptionIds: ["sub_1"],
        projectDisplayName: "Acme App",
      },
    });
  });

  it("does not snapshot a recipient email address", async () => {
    const tenancy = createActionTenancy();
    const plan = await buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    });

    expect(plan.recipient).toEqual({
      type: "user-primary-email",
      userId: "user-1",
    });
    expect(plan.variables).not.toHaveProperty("email");
    expect(plan.variables).not.toHaveProperty("primaryEmail");
    expect(plan.variables).not.toHaveProperty("recipientEmail");
  });

  it("fails loudly when the configured email template is missing", async () => {
    const tenancy = createActionTenancy(createRule({
      templateId: "1b477fe1-7479-4d90-ac47-23d0a5048bc8",
    }));

    await expect(buildTestSendEmailActionPlan({
      tenancy,
      ruleId,
      rule: getSupportedAutomationRule(tenancy, ruleId),
      decision: createActionDecision(),
    })).rejects.toThrow('Automation rule "low-api-credits" references email template "1b477fe1-7479-4d90-ac47-23d0a5048bc8", but that template does not exist.');
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  buildRuleFromDraft,
  getMissingPrerequisites,
  parseAutomationRouteResult,
  readRules,
  readUserItemOptions,
} from "./page-client";

vi.mock("@/components/design-components", () => ({
  DesignAlert: () => null,
  DesignBadge: () => null,
  DesignButton: () => null,
  DesignCard: () => null,
  DesignDialog: () => null,
  DesignDialogClose: () => null,
  DesignEmptyState: () => null,
  DesignInput: () => null,
  DesignListItemRow: () => null,
  DesignPillToggle: () => null,
  DesignSelectorDropdown: () => null,
}));

vi.mock("@/components/ui", () => ({
  Label: () => null,
  Typography: () => null,
}));

vi.mock("@/components/config-update", () => ({
  useUpdateConfig: () => async () => {},
}));

vi.mock("@/lib/hexclave-app-internals", () => ({
  sendAdminInternalRequestOrThrow: async () => new Response("{}"),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(" "),
}));

vi.mock("@hexclave/dashboard-ui-components", () => ({
  createDefaultDataGridState: () => ({
    sorting: [],
    quickSearch: "",
    pagination: {
      pageIndex: 0,
      pageSize: 25,
    },
  }),
  DataGrid: () => null,
  useDataSource: (options: { data?: unknown[] }) => ({
    rows: options.data ?? [],
    totalRowCount: options.data?.length ?? 0,
    isLoading: false,
  }),
}));

vi.mock("../app-enabled-guard", () => ({
  AppEnabledGuard: (props: { children: unknown }) => props.children,
}));

vi.mock("../page-layout", () => ({
  PageLayout: (props: { children: unknown }) => props.children,
}));

vi.mock("../use-admin-app", () => ({
  useAdminApp: () => {
    throw new Error("useAdminApp should not be called by usage email helper tests");
  },
}));

describe("usage email automation dashboard helpers", () => {
  it("reads V1 rules from automations.rules only", () => {
    const rules = readRules({
      automations: {
        rules: {
          usageUpgrade: {
            displayName: "Usage upgrade",
            enabled: true,
            source: {
              type: "payments-item-quota",
              itemId: "credits",
              customerType: "user",
              thresholds: {
                nearRemainingRatio: 0.2,
              },
            },
            action: {
              type: "send-email",
              templateId: "template-id",
              notificationCategoryName: "Marketing",
            },
            cooldown: {
              days: 7,
            },
          },
          unsupportedFutureRule: {
            enabled: true,
            source: {
              type: "client-push-quota",
              customerType: "user",
              thresholds: {
                nearRemainingRatio: 0.2,
              },
            },
            action: {
              type: "send-email",
              templateId: "template-id",
            },
            cooldown: {
              days: 7,
            },
          },
        },
      },
      payments: {
        quotaEmailAutomations: {
          wrongPlace: {},
        },
      },
      emails: {
        quotaEmailAutomations: {
          wrongPlace: {},
        },
      },
    });

    expect(rules).toMatchInlineSnapshot(`
      [
        {
          "rule": {
            "action": {
              "notificationCategoryName": "Marketing",
              "templateId": "template-id",
              "type": "send-email",
            },
            "cooldown": {
              "days": 7,
            },
            "displayName": "Usage upgrade",
            "enabled": true,
            "source": {
              "customerType": "user",
              "itemId": "credits",
              "thresholds": {
                "nearRemainingRatio": 0.2,
              },
              "type": "payments-item-quota",
            },
          },
          "ruleId": "usageUpgrade",
        },
      ]
    `);
  });

  it("lists only user-scoped Payments items", () => {
    expect(readUserItemOptions({
      payments: {
        items: {
          credits: {
            displayName: "Credits",
            customerType: "user",
          },
          seats: {
            displayName: "Seats",
            customerType: "team",
          },
        },
      },
    })).toMatchInlineSnapshot(`
      [
        {
          "label": "Credits",
          "value": "credits",
        },
      ]
    `);
  });

  it("detects missing usage email automation prerequisites", () => {
    expect(getMissingPrerequisites([], [])).toMatchInlineSnapshot(`
      [
        "paymentsItem",
        "emailTemplate",
      ]
    `);
    expect(getMissingPrerequisites([{ value: "credits", label: "Credits" }], [])).toMatchInlineSnapshot(`
      [
        "emailTemplate",
      ]
    `);
    expect(getMissingPrerequisites([], [{ value: "template-id", label: "Upgrade email" }])).toMatchInlineSnapshot(`
      [
        "paymentsItem",
      ]
    `);
    expect(getMissingPrerequisites([{ value: "credits", label: "Credits" }], [{ value: "template-id", label: "Upgrade email" }])).toMatchInlineSnapshot(`[]`);
  });

  it("builds a valid V1 rule from the editor draft", () => {
    expect(buildRuleFromDraft({
      ruleId: "usage-upgrade",
      displayName: "Usage upgrade",
      enabled: true,
      itemId: "credits",
      nearRemainingRatio: "0.25",
      nearRemainingQuantity: "10",
      overLimitQuantity: "0",
      templateId: "00000000-0000-0000-0000-000000000001",
      themeId: "__project_default__",
      subject: "Upgrade your plan",
      cooldownDays: "14",
    })).toMatchInlineSnapshot(`
      {
        "action": {
          "notificationCategoryName": "Marketing",
          "subject": "Upgrade your plan",
          "templateId": "00000000-0000-0000-0000-000000000001",
          "type": "send-email",
        },
        "cooldown": {
          "days": 14,
        },
        "displayName": "Usage upgrade",
        "enabled": true,
        "source": {
          "customerType": "user",
          "itemId": "credits",
          "thresholds": {
            "nearRemainingQuantity": 10,
            "nearRemainingRatio": 0.25,
            "overLimitQuantity": 0,
          },
          "type": "payments-item-quota",
        },
      }
    `);
  });

  it("rejects drafts without thresholds", () => {
    expect(() => buildRuleFromDraft({
      ruleId: "usage-upgrade",
      displayName: "Usage upgrade",
      enabled: true,
      itemId: "credits",
      nearRemainingRatio: "",
      nearRemainingQuantity: "",
      overLimitQuantity: "",
      templateId: "00000000-0000-0000-0000-000000000001",
      themeId: "__project_default__",
      subject: "",
      cooldownDays: "7",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: At least one threshold is required]`);
  });

  it("rejects drafts without a Payments item", () => {
    expect(() => buildRuleFromDraft({
      ruleId: "usage-upgrade",
      displayName: "Usage upgrade",
      enabled: true,
      itemId: "",
      nearRemainingRatio: "0.25",
      nearRemainingQuantity: "",
      overLimitQuantity: "0",
      templateId: "00000000-0000-0000-0000-000000000001",
      themeId: "__project_default__",
      subject: "",
      cooldownDays: "7",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: A Payments item is required]`);
  });

  it("rejects drafts without an email template", () => {
    expect(() => buildRuleFromDraft({
      ruleId: "usage-upgrade",
      displayName: "Usage upgrade",
      enabled: true,
      itemId: "credits",
      nearRemainingRatio: "0.25",
      nearRemainingQuantity: "",
      overLimitQuantity: "0",
      templateId: "",
      themeId: "__project_default__",
      subject: "",
      cooldownDays: "7",
    })).toThrowErrorMatchingInlineSnapshot(`[Error: An email template is required]`);
  });

  it("parses dry-run and run route responses", () => {
    expect(parseAutomationRouteResult({
      rule_id: "usage-upgrade",
      mode: "run",
      evaluated_count: 2,
      eligible_count: 1,
      suppressed_count: 1,
      sent_count: 1,
      next_cursor: null,
      decisions: [
        {
          subject_type: "user",
          subject_id: "user-1",
          signal_key: "credits:over",
          sent: true,
          source: {
            type: "payments-item-quota",
            item_id: "credits",
            current_quantity: 12,
            entitlement_quantity: 10,
            threshold_kind: "over",
            owned_product_ids: ["pro"],
            active_subscription_ids: ["sub-1"],
          },
          action: {
            type: "send-email",
            template_id: "template-id",
            notification_category_name: "Marketing",
          },
          cooldown: {
            blocked: false,
          },
        },
      ],
    })).toMatchInlineSnapshot(`
      {
        "decisions": [
          {
            "blocked": false,
            "currentQuantity": 12,
            "entitlementQuantity": 10,
            "hasPrimaryEmail": undefined,
            "sent": true,
            "skipReason": undefined,
            "subjectId": "user-1",
            "subjectType": "user",
            "thresholdKind": "over",
          },
        ],
        "eligibleCount": 1,
        "evaluatedCount": 2,
        "mode": "run",
        "nextCursor": null,
        "ruleId": "usage-upgrade",
        "sentCount": 1,
        "suppressedCount": 1,
      }
    `);
  });

  it("fails loudly for malformed automation decision rows", () => {
    expect(() => parseAutomationRouteResult({
      rule_id: "usage-upgrade",
      mode: "dry-run",
      evaluated_count: 1,
      eligible_count: 1,
      suppressed_count: 0,
      next_cursor: null,
      decisions: [
        {
          subject_type: "user",
          subject_id: "user-1",
          source: {
            type: "payments-item-quota",
            item_id: "credits",
            current_quantity: 12,
            entitlement_quantity: 10,
            threshold_kind: "future-threshold",
            owned_product_ids: [],
            active_subscription_ids: [],
          },
          cooldown: {
            blocked: false,
          },
          recipient: {
            user_exists: true,
            has_primary_email: true,
          },
        },
      ],
    })).toThrowErrorMatchingInlineSnapshot(`[Error: Automation response threshold_kind "future-threshold" is unsupported]`);
  });
});

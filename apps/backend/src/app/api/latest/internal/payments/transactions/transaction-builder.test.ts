import type { ItemQuantityChange, OneTimePurchase, Subscription } from "@prisma/client";
import { CustomerType, PurchaseCreationSource } from "@prisma/client";
import { describe, expect, it } from "vitest";
import type { Tenancy } from "@/lib/tenancies";
import { buildItemQuantityChangeTransaction, buildOneTimePurchaseTransaction, buildSubscriptionTransaction } from "./transaction-builder";

function createSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const baseCreatedAt = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: "sub_123",
    tenancyId: "tenancy_1",
    customerId: "user_1",
    customerType: "USER",
    productId: "prod_basic",
    priceId: "price_basic",
    product: {
      displayName: "Basic Plan",
      prices: {
        price_basic: {
          USD: "19.99",
          EUR: "17.99",
          interval: [1, "month"],
        },
      },
    },
    quantity: 3,
    stripeSubscriptionId: null,
    status: "active",
    currentPeriodEnd: new Date("2025-02-01T00:00:00.000Z"),
    currentPeriodStart: new Date("2025-01-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    creationSource: PurchaseCreationSource.PURCHASE_PAGE,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
    ...overrides,
  } as Subscription;
}

function createOneTimePurchase(overrides: Partial<OneTimePurchase> = {}): OneTimePurchase {
  const baseCreatedAt = new Date("2025-03-15T12:34:56.000Z");
  return {
    id: "otp_999",
    tenancyId: "tenancy_1",
    customerId: "team_5",
    customerType: "TEAM",
    productId: "prod_addon",
    priceId: "price_onetime",
    product: {
      displayName: "Add-on Pack",
      prices: {
        price_onetime: {
          EUR: "5.50",
        },
      },
    },
    quantity: 4,
    stripePaymentIntentId: "pi_123",
    createdAt: baseCreatedAt,
    creationSource: PurchaseCreationSource.PURCHASE_PAGE,
    ...overrides,
  } as OneTimePurchase;
}

function createItemQuantityChange(overrides: Partial<ItemQuantityChange> = {}): ItemQuantityChange {
  const baseCreatedAt = new Date("2025-04-01T09:00:00.000Z");
  return {
    id: "iqc_77",
    tenancyId: "tenancy_1",
    customerId: "external_42",
    customerType: "CUSTOM",
    itemId: "seats",
    quantity: -2,
    description: "Manual adjustment",
    expiresAt: null,
    createdAt: baseCreatedAt,
    ...overrides,
  } as ItemQuantityChange;
}

function createTenancyWithItemConfig(customerType: "user" | "team" | "custom"): Tenancy {
  return {
    id: "tenancy_1",
    config: {
      payments: {
        items: {
          seats: {
            customerType,
          },
        },
        products: {},
        catalogs: {},
      },
    },
    branchId: "main",
    organization: null,
    project: { id: "project_1" },
  } as unknown as Tenancy;
}

describe("transaction-builder", () => {
  it("builds subscription transactions with money transfer totals", () => {
    const subscription = createSubscription({
      quantity: 2,
    });
    const transaction = buildSubscriptionTransaction({ subscription });

    expect(transaction).toMatchInlineSnapshot(`
      {
        "adjusted_by": [],
        "created_at_millis": 1735689600000,
        "effective_at_millis": 1735689600000,
        "entries": [
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "customer_id": "user_1",
            "customer_type": "user",
            "one_time_purchase_id": undefined,
            "price_id": "price_basic",
            "product": {
              "client_metadata": null,
              "client_read_only_metadata": null,
              "customer_type": undefined,
              "display_name": "Basic Plan",
              "included_items": undefined,
              "prices": {
                "price_basic": {
                  "EUR": "17.99",
                  "USD": "19.99",
                  "interval": [
                    1,
                    "month",
                  ],
                },
              },
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "product_id": "prod_basic",
            "quantity": 2,
            "subscription_id": "sub_123",
            "type": "product_grant",
          },
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "charged_amount": {
              "EUR": "35.98",
              "USD": "39.98",
            },
            "customer_id": "user_1",
            "customer_type": "user",
            "net_amount": {
              "USD": "39.98",
            },
            "type": "money_transfer",
          },
        ],
        "id": "sub_123",
        "test_mode": false,
        "type": "purchase",
      }
    `);
  });

  it("omits money transfer entry for test-mode subscriptions", () => {
    const subscription = createSubscription({
      creationSource: PurchaseCreationSource.TEST_MODE,
    });
    const transaction = buildSubscriptionTransaction({ subscription });

    expect(transaction.entries).toHaveLength(1);
    expect(transaction.test_mode).toBe(true);
    expect(transaction.entries[0]).toMatchInlineSnapshot(`
      {
        "adjusted_entry_index": null,
        "adjusted_transaction_id": null,
        "customer_id": "user_1",
        "customer_type": "user",
        "one_time_purchase_id": undefined,
        "price_id": "price_basic",
        "product": {
          "client_metadata": null,
          "client_read_only_metadata": null,
          "customer_type": undefined,
          "display_name": "Basic Plan",
          "included_items": undefined,
          "prices": {
            "price_basic": {
              "EUR": "17.99",
              "USD": "19.99",
              "interval": [
                1,
                "month",
              ],
            },
          },
          "server_metadata": null,
          "server_only": false,
          "stackable": false,
        },
        "product_id": "prod_basic",
        "quantity": 3,
        "subscription_id": "sub_123",
        "type": "product_grant",
      }
    `);
  });

  it("builds one-time purchase transactions with currency multiplication", () => {
    const purchase = createOneTimePurchase();
    const transaction = buildOneTimePurchaseTransaction({ purchase });

    expect(transaction).toMatchInlineSnapshot(`
      {
        "adjusted_by": [],
        "created_at_millis": 1742042096000,
        "effective_at_millis": 1742042096000,
        "entries": [
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "customer_id": "team_5",
            "customer_type": "team",
            "one_time_purchase_id": "otp_999",
            "price_id": "price_onetime",
            "product": {
              "client_metadata": null,
              "client_read_only_metadata": null,
              "customer_type": undefined,
              "display_name": "Add-on Pack",
              "included_items": undefined,
              "prices": {
                "price_onetime": {
                  "EUR": "5.50",
                },
              },
              "server_metadata": null,
              "server_only": false,
              "stackable": false,
            },
            "product_id": "prod_addon",
            "quantity": 4,
            "subscription_id": undefined,
            "type": "product_grant",
          },
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "charged_amount": {
              "EUR": "22",
            },
            "customer_id": "team_5",
            "customer_type": "team",
            "net_amount": {
              "USD": "0",
            },
            "type": "money_transfer",
          },
        ],
        "id": "otp_999",
        "test_mode": false,
        "type": "purchase",
      }
    `);
  });

  it("builds manual item quantity change transactions", () => {
    const change = createItemQuantityChange();
    const tenancy = createTenancyWithItemConfig("custom");
    const transaction = buildItemQuantityChangeTransaction({ change, tenancy });

    expect(transaction).toMatchInlineSnapshot(`
      {
        "adjusted_by": [],
        "created_at_millis": 1743498000000,
        "effective_at_millis": 1743498000000,
        "entries": [
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "customer_id": "external_42",
            "customer_type": "custom",
            "item_id": "seats",
            "quantity": -2,
            "type": "item_quantity_change",
          },
        ],
        "id": "iqc_77",
        "test_mode": false,
        "type": "manual-item-quantity-change",
      }
    `);
  });

  it("builds subscription transactions when product snapshot is missing", () => {
    const subscription = createSubscription({ product: null });
    const transaction = buildSubscriptionTransaction({ subscription });

    expect(transaction).toMatchInlineSnapshot(`
      {
        "adjusted_by": [],
        "created_at_millis": 1735689600000,
        "effective_at_millis": 1735689600000,
        "entries": [
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "customer_id": "user_1",
            "customer_type": "user",
            "one_time_purchase_id": undefined,
            "price_id": "price_basic",
            "product": {
              "customer_type": "user",
              "display_name": "Unknown product",
              "included_items": {},
              "prices": {},
              "server_only": false,
              "stackable": false,
            },
            "product_id": "prod_basic",
            "quantity": 3,
            "subscription_id": "sub_123",
            "type": "product_grant",
          },
        ],
        "id": "sub_123",
        "test_mode": false,
        "type": "purchase",
      }
    `);
  });

  it("builds one-time purchase transactions when product snapshot is missing", () => {
    const purchase = createOneTimePurchase({ product: null });
    const transaction = buildOneTimePurchaseTransaction({ purchase });

    expect(transaction).toMatchInlineSnapshot(`
      {
        "adjusted_by": [],
        "created_at_millis": 1742042096000,
        "effective_at_millis": 1742042096000,
        "entries": [
          {
            "adjusted_entry_index": null,
            "adjusted_transaction_id": null,
            "customer_id": "team_5",
            "customer_type": "team",
            "one_time_purchase_id": "otp_999",
            "price_id": "price_onetime",
            "product": {
              "customer_type": "team",
              "display_name": "Unknown product",
              "included_items": {},
              "prices": {},
              "server_only": false,
              "stackable": false,
            },
            "product_id": "prod_addon",
            "quantity": 4,
            "subscription_id": undefined,
            "type": "product_grant",
          },
        ],
        "id": "otp_999",
        "test_mode": false,
        "type": "purchase",
      }
    `);
  });

  it("prefers the recorded customer type for item quantity changes", () => {
    const change = createItemQuantityChange({ customerType: CustomerType.TEAM });
    const tenancy = createTenancyWithItemConfig("user");
    const transaction = buildItemQuantityChangeTransaction({ change, tenancy });

    expect(transaction.entries[0]).toMatchInlineSnapshot(`
      {
        "adjusted_entry_index": null,
        "adjusted_transaction_id": null,
        "customer_id": "external_42",
        "customer_type": "team",
        "item_id": "seats",
        "quantity": -2,
        "type": "item_quantity_change",
      }
    `);
  });
});

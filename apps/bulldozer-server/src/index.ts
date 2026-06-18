import { node } from "@elysiajs/node";
import type { TransactionType } from "@hexclave/shared/dist/interface/crud/transactions";
import { Elysia } from "elysia";
import {
  getItemQuantitiesForCustomer,
  getOwnedProductsForCustomer,
  getSubscriptionMapForCustomer,
  readOutstandingItemGrants,
  readPriorRefundSummary,
  setManualItemQuantityChangeRow,
  setManualTransactionRow,
  setOneTimePurchaseRow,
  setSubscriptionInvoiceRow,
  setSubscriptionRow,
  verifyPaymentsDataIntegrity,
} from "./payments/bulldozer-payment-service";
import { runBulldozerPaymentsInit } from "./payments/bulldozer-payments-init";
import type { CustomerType } from "./payments/schema/types";
import { listTransactions } from "./payments/transaction-list-service";

const port = Number(process.env.BULLDOZER_SERVER_PORT ?? `${process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81"}46`);

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

function notImplemented(operation: string) {
  return jsonResponse({
    error: "not_implemented",
    operation,
  }, { status: 501 });
}

async function handler(operation: () => Promise<unknown>) {
  try {
    return jsonResponse(await operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Bulldozer server error";
    console.error("[Bulldozer Server] Request failed", error);
    return jsonResponse({
      error: "bulldozer_server_error",
      message,
    }, { status: 500 });
  }
}

function parseCustomerType(value: string): CustomerType {
  if (value === "user" || value === "team" || value === "custom") {
    return value;
  }
  throw new Error(`Invalid customer type: ${value}`);
}

function parseTransactionType(value: string | undefined): TransactionType | undefined {
  if (value == null) return undefined;
  if (
    value === "purchase" ||
    value === "subscription-cancellation" ||
    value === "manual-item-quantity-change" ||
    value === "subscription-renewal" ||
    value === "refund" ||
    value === "chargeback" ||
    value === "product-change"
  ) {
    return value;
  }
  throw new Error(`Invalid transaction type: ${value}`);
}

function readObjectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body == null || Array.isArray(body)) {
    throw new Error("Expected JSON object body");
  }
  return Object.fromEntries(Object.entries(body));
}

function readStringField(body: Record<string, unknown>, fieldName: string): string {
  const value = body[fieldName];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty string field: ${fieldName}`);
  }
  return value;
}

function ok() {
  return { success: true };
}

const app = new Elysia({ adapter: node() })
  .get("/health", () => ({ ok: true }))
  .post("/internal/payments/init", () => handler(async () => {
    await runBulldozerPaymentsInit();
    return ok();
  }))
  .post("/internal/payments/verify-data-integrity", () => handler(async () => {
    await verifyPaymentsDataIntegrity();
    return ok();
  }))

  .get("/v1/:tenancyId/transactions", ({ params, query }) => handler(async () => {
    const rawLimit = typeof query.limit === "string" ? query.limit : "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));
    const result = await listTransactions({
      tenancyId: params.tenancyId,
      limit,
      cursor: typeof query.cursor === "string" ? query.cursor : undefined,
      type: parseTransactionType(typeof query.type === "string" ? query.type : undefined),
      customerType: typeof query.customer_type === "string" ? parseCustomerType(query.customer_type) : undefined,
      customerId: typeof query.customer_id === "string" ? query.customer_id : undefined,
    });
    return {
      transactions: result.transactions,
      next_cursor: result.nextCursor,
    };
  }))
  .get("/v1/:tenancyId/customers/:customerType/:customerId/transactions", ({ params, query }) => handler(async () => {
    const rawLimit = typeof query.limit === "string" ? query.limit : "50";
    const parsedLimit = Number.parseInt(rawLimit, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(parsedLimit) ? parsedLimit : 50));
    const result = await listTransactions({
      tenancyId: params.tenancyId,
      limit,
      cursor: typeof query.cursor === "string" ? query.cursor : undefined,
      type: parseTransactionType(typeof query.type === "string" ? query.type : undefined),
      customerType: parseCustomerType(params.customerType),
      customerId: params.customerId,
    });
    return {
      transactions: result.transactions,
      next_cursor: result.nextCursor,
    };
  }))
  .post("/v1/:tenancyId/transactions/:transactionId/refund", ({ params, body }) => handler(async () => {
    await setManualTransactionRow({
      tenancyId: params.tenancyId,
      transactionId: params.transactionId,
      body,
    });
    return ok();
  }))
  .post("/v1/:tenancyId/refunds/prior-summary", ({ params, body }) => handler(async () => {
    const request = readObjectBody(body);
    return await readPriorRefundSummary({
      tenancyId: params.tenancyId,
      customerType: parseCustomerType(readStringField(request, "customerType")),
      customerId: readStringField(request, "customerId"),
      sourceTxnId: readStringField(request, "sourceTxnId"),
    });
  }))
  .post("/v1/:tenancyId/refunds/outstanding-item-grants", ({ params, body }) => handler(async () => {
    const request = readObjectBody(body);
    return {
      grants: await readOutstandingItemGrants({
        tenancyId: params.tenancyId,
        customerType: parseCustomerType(readStringField(request, "customerType")),
        customerId: readStringField(request, "customerId"),
        sourceTxnId: readStringField(request, "sourceTxnId"),
        igrSourceId: readStringField(request, "igrSourceId"),
      }),
    };
  }))

  .get("/v1/:tenancyId/customers/:customerType/:customerId/owned-products", ({ params }) => handler(async () => ({
    ownedProducts: await getOwnedProductsForCustomer({
      tenancyId: params.tenancyId,
      customerType: parseCustomerType(params.customerType),
      customerId: params.customerId,
    }),
  })))
  .get("/v1/:tenancyId/customers/:customerType/:customerId/item-quantities", ({ params }) => handler(async () => ({
    itemQuantities: await getItemQuantitiesForCustomer({
      tenancyId: params.tenancyId,
      customerType: parseCustomerType(params.customerType),
      customerId: params.customerId,
    }),
  })))
  .get("/v1/:tenancyId/customers/:customerType/:customerId/subscriptions", ({ params }) => handler(async () => ({
    subscriptions: await getSubscriptionMapForCustomer({
      tenancyId: params.tenancyId,
      customerType: parseCustomerType(params.customerType),
      customerId: params.customerId,
    }),
  })))

  .post("/v1/:tenancyId/customers/:customerType/:customerId/manual-product-grants", () => notImplemented("create-manual-product-grant"))
  .post("/v1/:tenancyId/customers/:customerType/:customerId/manual-item-quantity-changes", ({ params, body }) => handler(async () => {
    await setManualItemQuantityChangeRow({
      tenancyId: params.tenancyId,
      customerType: parseCustomerType(params.customerType),
      customerId: params.customerId,
      body,
    });
    return ok();
  }))

  .post("/v1/:tenancyId/stripe/subscription-invoices/changed", ({ params, body }) => handler(async () => {
    await setSubscriptionInvoiceRow({ tenancyId: params.tenancyId, body });
    return ok();
  }))
  .post("/v1/:tenancyId/stripe/subscriptions/changed", ({ params, body }) => handler(async () => {
    await setSubscriptionRow({ tenancyId: params.tenancyId, body });
    return ok();
  }))
  .post("/v1/:tenancyId/stripe/one-time-purchases/changed", ({ params, body }) => handler(async () => {
    await setOneTimePurchaseRow({ tenancyId: params.tenancyId, body });
    return ok();
  }))

  .post("/v1/:tenancyId/test-mode/subscriptions", () => notImplemented("create-test-mode-subscription"))
  .post("/v1/:tenancyId/test-mode/subscriptions/:subscriptionId/end", () => notImplemented("end-test-mode-subscription"))
  .post("/v1/:tenancyId/test-mode/one-time-purchases", () => notImplemented("create-test-mode-one-time-purchase"))
  .post("/v1/:tenancyId/test-mode/subscriptions/:subscriptionId/switch", () => notImplemented("switch-test-mode-subscription"))

  .listen(port);

console.log(`Bulldozer server listening on http://localhost:${app.server?.port ?? port}`);

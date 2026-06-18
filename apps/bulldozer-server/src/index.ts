import { Elysia } from "elysia";

const port = Number(process.env.BULLDOZER_SERVER_PORT ?? `${process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81"}46`);

function notImplemented(operation: string) {
  return new Response(JSON.stringify({
    error: "not_implemented",
    operation,
  }), {
    status: 501,
    headers: {
      "content-type": "application/json",
    },
  });
}

const app = new Elysia()
  .get("/health", () => ({ ok: true }))

  .get("/v1/:tenancyId/transactions", () => notImplemented("list-tenancy-transactions"))
  .get("/v1/:tenancyId/customers/:customerType/:customerId/transactions", () => notImplemented("list-customer-transactions"))
  .post("/v1/:tenancyId/transactions/:transactionId/refund", () => notImplemented("refund-transaction"))

  .get("/v1/:tenancyId/customers/:customerType/:customerId/owned-products", () => notImplemented("get-owned-products"))
  .get("/v1/:tenancyId/customers/:customerType/:customerId/item-quantities", () => notImplemented("get-item-quantities"))
  .get("/v1/:tenancyId/customers/:customerType/:customerId/subscriptions", () => notImplemented("get-subscriptions"))

  .post("/v1/:tenancyId/customers/:customerType/:customerId/manual-product-grants", () => notImplemented("create-manual-product-grant"))
  .post("/v1/:tenancyId/customers/:customerType/:customerId/manual-item-quantity-changes", () => notImplemented("create-manual-item-quantity-change"))

  .post("/v1/:tenancyId/stripe/subscription-invoices/changed", () => notImplemented("stripe-subscription-invoice-changed"))
  .post("/v1/:tenancyId/stripe/subscriptions/changed", () => notImplemented("stripe-subscription-changed"))
  .post("/v1/:tenancyId/stripe/one-time-purchases/changed", () => notImplemented("stripe-one-time-purchase-changed"))

  .post("/v1/:tenancyId/test-mode/subscriptions", () => notImplemented("create-test-mode-subscription"))
  .post("/v1/:tenancyId/test-mode/subscriptions/:subscriptionId/end", () => notImplemented("end-test-mode-subscription"))
  .post("/v1/:tenancyId/test-mode/one-time-purchases", () => notImplemented("create-test-mode-one-time-purchase"))
  .post("/v1/:tenancyId/test-mode/subscriptions/:subscriptionId/switch", () => notImplemented("switch-test-mode-subscription"))

  .listen(port);

console.log(`Bulldozer server listening on http://localhost:${app.server?.port ?? port}`);

import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";

const USER_COUNT = 6;
const ITEM_UPDATES_PER_USER = 10;

// The benchmark can be run against a tenancy that already holds payments data, to see how the
// measured flows scale with the amount of data Bulldozer keeps in its trees. One prefill unit is one
// fully-populated customer (a subscription purchase, a one-time purchase, two granted stackable
// products and ITEM_UPDATES_PER_USER item-quantity changes) written into the same tenancy before any
// measurement happens. The measured workload stays identical at every level, so the only thing that
// varies between runs is the volume of pre-existing data.
const PREFILL_CUSTOMERS = Number(process.env.HEXCLAVE_PAYMENTS_PERF_PREFILL ?? "0");
if (!Number.isInteger(PREFILL_CUSTOMERS) || PREFILL_CUSTOMERS < 0) {
  throw new Error(`HEXCLAVE_PAYMENTS_PERF_PREFILL must be a non-negative integer, got ${process.env.HEXCLAVE_PAYMENTS_PERF_PREFILL}`);
}
// When set, the summary is also written to this path as JSON, so that a sweep over several prefill
// levels can be aggregated and plotted afterwards.
const OUTPUT_PATH = process.env.HEXCLAVE_PAYMENTS_PERF_OUTPUT;

type PerfMetric = {
  name: string,
  count: number,
  elapsedMs: number,
};

async function measure<T>(name: string, count: number, fn: () => Promise<T>, metrics: PerfMetric[]): Promise<T> {
  const startedAt = performance.now();
  const result = await fn();
  const elapsedMs = performance.now() - startedAt;
  metrics.push({ name, count, elapsedMs });
  const throughput = count === 0 ? "n/a" : `${(count / elapsedMs * 1000).toFixed(2)} ops/s`;
  console.log(`[bulldozer-payments-e2e-perf] ${name}: ${elapsedMs.toFixed(1)} ms (${count} ops, ${throughput})`);
  return result;
}

async function createPurchaseCode(options: { customerType: "user", customerId: string, productId: string }) {
  const res = await niceBackendFetch("/api/latest/payments/purchases/create-purchase-url", {
    method: "POST",
    accessType: "server",
    body: {
      customer_type: options.customerType,
      customer_id: options.customerId,
      product_id: options.productId,
    },
  });
  expect(res.status).toBe(200);
  const codeMatch = (res.body.url as string).match(/\/purchase\/([a-z0-9-_]+)/);
  const code = codeMatch ? codeMatch[1] : undefined;
  expect(code).toBeDefined();
  return code as string;
}

async function listAllTransactions() {
  const transactions: unknown[] = [];
  let cursor: string | null = null;
  do {
    const response = await niceBackendFetch("/api/latest/internal/payments/transactions", {
      accessType: "admin",
      query: {
        limit: "200",
        ...(cursor == null ? {} : { cursor }),
      },
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.transactions)).toBe(true);
    transactions.push(...response.body.transactions);
    cursor = response.body.next_cursor;
  } while (cursor != null);
  return transactions;
}

// The measured workload alone fits comfortably into the base timeout; prefilling is what can take
// arbitrarily long, so the budget grows with the requested prefill size.
const TEST_TIMEOUT_MS = 240_000 + PREFILL_CUSTOMERS * 30_000;

it("benchmarks backend-level payments flows through the Bulldozer HTTP boundary", { timeout: TEST_TIMEOUT_MS }, async () => {
  const metrics: PerfMetric[] = [];

  await measure("setup project + payments config", 1, async () => {
    await Project.createAndSwitch();
    await Payments.setup();
    await Project.updateConfig({
      payments: {
        testMode: true,
        products: {
          "perf-sub": {
            displayName: "Perf Subscription",
            customerType: "user",
            serverOnly: false,
            stackable: true,
            prices: {
              monthly: { USD: "10.00", interval: [1, "month"] },
            },
            includedItems: {
              credits: { quantity: 10, repeat: [1, "month"], expires: "when-repeated" },
              seats: { quantity: 1, expires: "when-purchase-expires" },
            },
          },
          "perf-otp": {
            displayName: "Perf One-Time Purchase",
            customerType: "user",
            serverOnly: false,
            stackable: true,
            prices: {
              single: { USD: "5.00" },
            },
            includedItems: {
              credits: { quantity: 5, expires: "never" },
            },
          },
          "perf-api-grant": {
            displayName: "Perf API Grant",
            customerType: "user",
            serverOnly: false,
            stackable: true,
            prices: {
              monthly: { USD: "0.00", interval: [1, "month"] },
            },
            includedItems: {
              credits: { quantity: 3, expires: "when-purchase-expires" },
            },
          },
        },
        items: {
          credits: { displayName: "Credits", customerType: "user" },
          seats: { displayName: "Seats", customerType: "user" },
          boosts: { displayName: "Boosts", customerType: "user" },
        },
      },
    });
  }, metrics);

  await measure("prefill existing payments data", PREFILL_CUSTOMERS, async () => {
    for (let i = 0; i < PREFILL_CUSTOMERS; i++) {
      const { userId } = await Auth.fastSignUp();

      const subscriptionCode = await createPurchaseCode({ customerType: "user", customerId: userId, productId: "perf-sub" });
      const subscriptionResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
        accessType: "admin",
        method: "POST",
        body: { full_code: subscriptionCode, price_id: "monthly", quantity: 1 },
      });
      expect(subscriptionResponse.status).toBe(200);

      const oneTimeCode = await createPurchaseCode({ customerType: "user", customerId: userId, productId: "perf-otp" });
      const oneTimeResponse = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
        accessType: "admin",
        method: "POST",
        body: { full_code: oneTimeCode, price_id: "single", quantity: 2 },
      });
      expect(oneTimeResponse.status).toBe(200);

      for (let grant = 0; grant < 2; grant++) {
        const grantResponse = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
          method: "POST",
          accessType: "server",
          body: { product_id: "perf-api-grant", quantity: 1 },
        });
        expect(grantResponse.status).toBe(200);
      }

      for (let update = 0; update < ITEM_UPDATES_PER_USER; update++) {
        const itemId = update % 2 === 0 ? "credits" : "boosts";
        const updateResponse = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}/update-quantity`, {
          method: "POST",
          accessType: "server",
          query: { allow_negative: "false" },
          body: { delta: update + 1, description: `prefill-${i}-${update}` },
        });
        expect(updateResponse.status).toBe(200);
      }
    }
  }, metrics);

  const users = await measure("create users", USER_COUNT, async () => {
    const createdUsers: string[] = [];
    for (let i = 0; i < USER_COUNT; i++) {
      const { userId } = await Auth.fastSignUp();
      createdUsers.push(userId);
    }
    return createdUsers;
  }, metrics);

  await measure("create + redeem test-mode subscription purchases", users.length, async () => {
    for (const userId of users) {
      const code = await createPurchaseCode({ customerType: "user", customerId: userId, productId: "perf-sub" });
      const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
        accessType: "admin",
        method: "POST",
        body: { full_code: code, price_id: "monthly", quantity: 1 },
      });
      expect(response.status).toBe(200);
    }
  }, metrics);

  await measure("create + redeem test-mode one-time purchases", users.length, async () => {
    for (const userId of users) {
      const code = await createPurchaseCode({ customerType: "user", customerId: userId, productId: "perf-otp" });
      const response = await niceBackendFetch("/api/latest/internal/payments/test-mode-purchase-session", {
        accessType: "admin",
        method: "POST",
        body: { full_code: code, price_id: "single", quantity: 2 },
      });
      expect(response.status).toBe(200);
    }
  }, metrics);

  await measure("grant stackable subscription products via server API", users.length * 2, async () => {
    for (const userId of users) {
      for (let i = 0; i < 2; i++) {
        const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
          method: "POST",
          accessType: "server",
          body: {
            product_id: "perf-api-grant",
            quantity: 1,
          },
        });
        expect(response.status).toBe(200);
      }
    }
  }, metrics);

  await measure("write manual item quantity changes", users.length * ITEM_UPDATES_PER_USER, async () => {
    for (const userId of users) {
      for (let i = 0; i < ITEM_UPDATES_PER_USER; i++) {
        const itemId = i % 2 === 0 ? "credits" : "boosts";
        const response = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}/update-quantity`, {
          method: "POST",
          accessType: "server",
          query: { allow_negative: "false" },
          body: {
            delta: i + 1,
            description: `perf-${i}`,
          },
        });
        expect(response.status).toBe(200);
      }
    }
  }, metrics);

  await measure("read owned products for all users", users.length, async () => {
    for (const userId of users) {
      const response = await niceBackendFetch(`/api/v1/payments/products/user/${userId}`, {
        accessType: "server",
      });
      expect(response.status).toBe(200);
      expect(response.body.items.length).toBeGreaterThan(0);
    }
  }, metrics);

  await measure("read item quantities for all users", users.length * 3, async () => {
    for (const userId of users) {
      for (const itemId of ["credits", "seats", "boosts"]) {
        const response = await niceBackendFetch(`/api/latest/payments/items/user/${userId}/${itemId}`, {
          accessType: "server",
        });
        expect(response.status).toBe(200);
        expect(typeof response.body.quantity).toBe("number");
      }
    }
  }, metrics);

  const transactions = await measure("list all transactions with pagination", 1, listAllTransactions, metrics);
  expect(transactions.length).toBeGreaterThanOrEqual(users.length * 4);

  const summary = {
    prefillCustomers: PREFILL_CUSTOMERS,
    users: users.length,
    transactions: transactions.length,
    metrics: metrics.map((metric) => ({
      name: metric.name,
      count: metric.count,
      elapsedMs: Number(metric.elapsedMs.toFixed(1)),
      opsPerSecond: metric.count === 0 ? null : Number((metric.count / metric.elapsedMs * 1000).toFixed(2)),
    })),
  };
  console.log("[bulldozer-payments-e2e-perf] summary", JSON.stringify(summary));

  if (OUTPUT_PATH != null) {
    fs.mkdirSync(path.dirname(path.resolve(OUTPUT_PATH)), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));
  }
});

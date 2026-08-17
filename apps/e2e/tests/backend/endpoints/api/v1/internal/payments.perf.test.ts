import { expect } from "vitest";
import { it } from "../../../../../helpers";
import { Auth, Payments, Project, niceBackendFetch } from "../../../../backend-helpers";

const USER_COUNT = 6;
const ITEM_UPDATES_PER_USER = 10;

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
  console.log(`[bulldozer-payments-e2e-perf] ${name}: ${elapsedMs.toFixed(1)} ms (${count} ops, ${(count / elapsedMs * 1000).toFixed(2)} ops/s)`);
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

it("benchmarks backend-level payments flows through the Bulldozer HTTP boundary", { timeout: 240_000 }, async () => {
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

  console.log("[bulldozer-payments-e2e-perf] summary", JSON.stringify({
    users: users.length,
    transactions: transactions.length,
    metrics: metrics.map((metric) => ({
      name: metric.name,
      count: metric.count,
      elapsedMs: Number(metric.elapsedMs.toFixed(1)),
      opsPerSecond: Number((metric.count / metric.elapsedMs * 1000).toFixed(2)),
    })),
  }));
});
